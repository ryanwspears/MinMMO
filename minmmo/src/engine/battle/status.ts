import type {
  FormulaContext,
  RuntimeEffect,
  RuntimeStatusTemplate,
  ValueResolver,
} from '@content/adapters'
import { Statuses } from '@content/registry'
import { elementMult, tagResistMult } from './rules'
import type {
  Actor,
  ActorStatusModifierCache,
  BattleState,
  Resource,
  Status,
  StatusModifierSnapshot,
} from './types'

export interface StatusApplyOptions {
  stacks?: number
  sourceId?: string
}

type StatusHookName = keyof RuntimeStatusTemplate['hooks']

interface ActiveStatus extends Status {
  stacks: number
  sourceId?: string
}

interface StatusEventContext {
  kind: StatusHookName
  amount?: number
  element?: string
  otherId?: string
}

interface StatusControl {
  preventAction(message?: string): void
  prevented: boolean
}

interface StatusFormulaContext extends FormulaContext {
  state: BattleState
  status: RuntimeStatusTemplate
  entry: ActiveStatus
  source: Actor
  event?: StatusEventContext
  control?: StatusControl
}

interface HookOptions {
  other?: Actor
  amount?: number
  element?: string
  control?: StatusControl
}

interface ShieldImpact {
  id: string
  absorbed: number
}

export function applyStatus(
  state: BattleState,
  targetId: string,
  statusId: string,
  turns: number,
  options: StatusApplyOptions = {},
): void {
  const target = state.actors[targetId]
  if (!target) {
    pushLog(state, `Tried to apply unknown status ${statusId} to missing actor ${targetId}.`)
    return
  }

  const template = Statuses()[statusId]
  if (!template) {
    pushLog(state, `Status ${statusId} is not defined.`)
    return
  }

  const duration = resolveDuration(turns, template)
  if (duration <= 0) {
    pushLog(state, `${template.name ?? template.id} had no effect.`)
    return
  }

  const stacksToAdd = Math.max(1, Math.floor(options.stacks ?? 1))
  const active = ensureStatuses(target)
  const existingIndex = active.findIndex((entry) => entry.id === statusId)
  const name = template.name ?? template.id

  const maxStacks = template.maxStacks ?? Infinity
  const clampStacks = (value: number) => clamp(value, 1, maxStacks)

  if (existingIndex >= 0) {
    const existing = active[existingIndex]
    switch (template.stackRule) {
      case 'ignore':
        pushLog(state, `${name} is already affecting ${target.name}.`)
        return
      case 'stackCount':
        existing.stacks = clampStacks(existing.stacks + stacksToAdd)
        existing.turns = duration
        break
      case 'stackMagnitude':
        existing.stacks = clampStacks(existing.stacks + stacksToAdd)
        existing.turns = duration
        break
      case 'renew':
      default:
        existing.turns = duration
        existing.stacks = clampStacks(stacksToAdd)
        break
    }
    if (options.sourceId) {
      existing.sourceId = options.sourceId
    }
    syncStatusModifiers(state, target, existing, template)
    pushLog(state, `${target.name}'s ${name} was refreshed (${existing.turns} turns).`)
    runHookForEntry(state, target, template, existing, 'onApply', {
      other: resolveSourceActor(state, existing.sourceId) ?? target,
    })
    return
  }

  const entry: ActiveStatus = {
    id: statusId,
    turns: duration,
    stacks: clampStacks(stacksToAdd),
  }
  if (options.sourceId) {
    entry.sourceId = options.sourceId
  }

  active.push(entry)
  syncStatusModifiers(state, target, entry, template)
  pushLog(state, `${target.name} is afflicted by ${name} for ${duration} turns.`)
  runHookForEntry(state, target, template, entry, 'onApply', {
    other: resolveSourceActor(state, entry.sourceId) ?? target,
  })
}

export function tickStartOfTurn(state: BattleState, actorOrId: string | Actor): boolean {
  const actor = typeof actorOrId === 'string' ? state.actors[actorOrId] : actorOrId
  if (!actor || !actor.alive) {
    return false
  }

  const control = createStatusControl(state, actor)
  triggerStatusHooks(state, actor, 'onTurnStart', {
    other: actor,
    control,
  })

  return control.prevented
}

export function tickEndOfTurn(state: BattleState, actorOrId: string | Actor): void {
  const actor = typeof actorOrId === 'string' ? state.actors[actorOrId] : actorOrId
  if (!actor) {
    return
  }

  const statuses = ensureStatuses(actor)
  const regenSnapshot = cloneResourceRegenMap(actor.statusModifiers?.resourceRegenPerTurn)
  const hasRegen = regenSnapshot && Object.keys(regenSnapshot).length > 0

  if (statuses.length === 0 && !state.taunts[actor.id] && !hasRegen) {
    return
  }

  const next: ActiveStatus[] = []
  for (const entry of statuses) {
    const template = Statuses()[entry.id]
    if (!template) {
      continue
    }

    runHookForEntry(state, actor, template, entry, 'onTurnEnd', {
      other: resolveSourceActor(state, entry.sourceId) ?? actor,
    })

    entry.turns -= 1
    if (entry.turns > 0) {
      next.push(entry)
    } else {
      pushLog(state, `${template.name ?? template.id} expired on ${actor.name}.`)
      expireStatus(state, actor, template, entry)
    }
  }

  actor.statuses = next
  applyResourceRegen(actor, regenSnapshot)
  tickTaunt(state, actor)
}

export function triggerStatusHooks(
  state: BattleState,
  actor: Actor,
  hook: StatusHookName,
  options: HookOptions = {},
): void {
  const statuses = ensureStatuses(actor)
  for (const entry of statuses) {
    const template = Statuses()[entry.id]
    if (!template) {
      continue
    }
    const other = options.other ?? resolveSourceActor(state, entry.sourceId) ?? actor
    runHookForEntry(state, actor, template, entry, hook, {
      ...options,
      other,
    })
  }
}

export function grantShield(
  state: BattleState,
  actor: Actor,
  shieldId: string,
  amount: number,
  element?: string,
  { replace = false }: { replace?: boolean } = {},
): number {
  const map = ensureShieldMap(state, actor.id)
  const safe = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0))

  if (safe <= 0 && replace) {
    delete map[shieldId]
    return 0
  }

  const existing = map[shieldId] ?? { id: shieldId, hp: 0 as number, element }
  if (replace) {
    existing.hp = safe
  } else {
    existing.hp = Math.max(0, existing.hp + safe)
  }
  if (element !== undefined) {
    existing.element = element
  }
  map[shieldId] = existing
  return existing.hp
}

export function absorbDamageWithShields(
  state: BattleState,
  actor: Actor,
  amount: number,
  element?: string,
): { remaining: number; absorbed: number; logs: string[] } {
  const map = state.shields[actor.id]
  let remaining = Math.max(0, amount)
  if (!map || remaining <= 0) {
    return { remaining, absorbed: 0, logs: [] }
  }

  const logs: string[] = []
  const impacts: ShieldImpact[] = []
  for (const [shieldId, shield] of Object.entries(map)) {
    if (remaining <= 0) {
      break
    }
    if (shield.hp <= 0) {
      delete map[shieldId]
      continue
    }
    const absorbed = Math.min(remaining, shield.hp)
    shield.hp -= absorbed
    remaining -= absorbed
    impacts.push({ id: shieldId, absorbed })
    if (shield.hp <= 0) {
      delete map[shieldId]
      logs.push(`${actor.name}'s ${shieldId} shattered.`)
    }
  }

  for (const impact of impacts) {
    if (impact.absorbed <= 0) {
      continue
    }
    logs.unshift(`${actor.name}'s ${impact.id} absorbed ${Math.round(impact.absorbed)} damage.`)
  }

  const absorbedTotal = Math.max(0, amount - remaining)
  return { remaining, absorbed: absorbedTotal, logs }
}

export function cleanseStatuses(
  state: BattleState,
  actor: Actor,
  tags?: string[],
): string[] {
  const statuses = ensureStatuses(actor)
  if (statuses.length === 0) {
    return []
  }

  const tagSet = tags && tags.length ? new Set(tags) : undefined
  const kept: ActiveStatus[] = []
  const removedNames: string[] = []

  for (const entry of statuses) {
    const template = Statuses()[entry.id]
    if (!template) {
      continue
    }
    const match = !tagSet
      ? true
      : (template.tags ?? []).some((tag) => tagSet.has(tag))
    if (match) {
      removedNames.push(template.name ?? template.id)
      expireStatus(state, actor, template, entry)
    } else {
      kept.push(entry)
    }
  }

  actor.statuses = kept
  return removedNames
}

export function applyTaunt(
  state: BattleState,
  targetId: string,
  sourceId: string,
  turns: number,
): void {
  const safeTurns = Math.max(0, Math.floor(Number.isFinite(turns) ? turns : 0))
  if (safeTurns <= 0) {
    delete state.taunts[targetId]
    return
  }
  state.taunts[targetId] = { sourceId, turns: safeTurns }
}

function tickTaunt(state: BattleState, actor: Actor) {
  const taunt = state.taunts[actor.id]
  if (!taunt) {
    return
  }
  taunt.turns -= 1
  if (taunt.turns <= 0) {
    delete state.taunts[actor.id]
    pushLog(state, `${actor.name} is no longer taunted.`)
  }
}

function createStatusControl(state: BattleState, actor: Actor): StatusControl {
  const control: StatusControl = {
    prevented: false,
    preventAction(message?: string) {
      if (control.prevented) {
        return
      }
      control.prevented = true
      const text = message && message.trim().length > 0
        ? message
        : `${actor.name} is unable to act.`
      pushLog(state, text)
    },
  }
  return control
}

function runHookForEntry(
  state: BattleState,
  actor: Actor,
  template: RuntimeStatusTemplate,
  entry: ActiveStatus,
  hook: StatusHookName,
  options: HookOptions = {},
) {
  const effects = template.hooks?.[hook] ?? []
  if (effects.length === 0) {
    return
  }

  const owner = actor
  const other = options.other ?? actor
  const source =
    hook === 'onTurnEnd' || hook === 'onTurnStart' || hook === 'onApply' || hook === 'onExpire'
      ? resolveSourceActor(state, entry.sourceId) ?? owner
      : owner

  const target =
    hook === 'onDealDamage'
      ? owner
      : hook === 'onTakeDamage'
        ? other
        : owner

  const ctx: StatusFormulaContext = {
    state,
    status: template,
    entry,
    source,
    control: options.control,
    event: {
      kind: hook,
      amount: options.amount,
      element: options.element,
      otherId: other.id,
    },
  }

  for (const effect of effects) {
    applyHookEffect(state, template, effect, source, target, ctx)
  }
}

function expireStatus(
  state: BattleState,
  actor: Actor,
  template: RuntimeStatusTemplate,
  entry: ActiveStatus,
) {
  removeStatusModifierSnapshot(actor, entry)
  clearStatusShield(state, actor, template)
  runHookForEntry(state, actor, template, entry, 'onExpire', {
    other: resolveSourceActor(state, entry.sourceId) ?? actor,
  })
}

function syncStatusModifiers(
  state: BattleState,
  actor: Actor,
  entry: ActiveStatus,
  template: RuntimeStatusTemplate,
) {
  const shield = template.modifiers?.shield
  if (shield) {
    const total = (Number.isFinite(shield.hp) ? shield.hp : 0) * entry.stacks
    grantShield(state, actor, shield.id ?? template.id, total, shield.element, { replace: true })
  } else if (template.modifiers?.shield === null) {
    clearStatusShield(state, actor, template)
  }

  applyStatusModifierSnapshot(actor, entry, template)
}

function clearStatusShield(
  state: BattleState,
  actor: Actor,
  template: RuntimeStatusTemplate,
) {
  const shieldId = template.modifiers?.shield?.id ?? template.id
  const map = state.shields[actor.id]
  if (!map) {
    return
  }
  delete map[shieldId]
}

function applyStatusModifierSnapshot(actor: Actor, entry: ActiveStatus, template: RuntimeStatusTemplate) {
  const next = createSnapshotFromTemplate(template, entry)
  const prev = entry.appliedModifiers
  if (!prev && !next) {
    return
  }

  updateActorFromSnapshot(actor, prev, next)
  entry.appliedModifiers = next
}

function removeStatusModifierSnapshot(actor: Actor, entry: ActiveStatus) {
  if (!entry.appliedModifiers) {
    return
  }
  updateActorFromSnapshot(actor, entry.appliedModifiers, undefined)
  entry.appliedModifiers = undefined
}

function createSnapshotFromTemplate(template: RuntimeStatusTemplate, entry: ActiveStatus):
  | StatusModifierSnapshot
  | undefined {
  const modifiers = template.modifiers
  if (!modifiers) {
    return undefined
  }

  const stacks = Math.max(1, Number.isFinite(entry.stacks) ? entry.stacks : 1)
  const snapshot: StatusModifierSnapshot = {}

  if (Number.isFinite(modifiers.atk)) {
    snapshot.atk = (modifiers.atk ?? 0) * stacks
  }
  if (Number.isFinite(modifiers.def)) {
    snapshot.def = (modifiers.def ?? 0) * stacks
  }

  if (modifiers.damageTakenPct) {
    snapshot.damageTakenPct = scaleRecord(modifiers.damageTakenPct, stacks)
  }
  if (modifiers.damageDealtPct) {
    snapshot.damageDealtPct = scaleRecord(modifiers.damageDealtPct, stacks)
  }
  if (modifiers.resourceRegenPerTurn) {
    snapshot.resourceRegenPerTurn = scaleRecord(modifiers.resourceRegenPerTurn, stacks)
  }
  if (Number.isFinite(modifiers.dodgeBonus)) {
    snapshot.dodgeBonus = (modifiers.dodgeBonus ?? 0) * stacks
  }
  if (Number.isFinite(modifiers.critChanceBonus)) {
    snapshot.critChanceBonus = (modifiers.critChanceBonus ?? 0) * stacks
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined
}

function scaleRecord(record: Record<string, number | undefined>, factor: number): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(record)) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric !== 0) {
      result[key] = numeric * factor
    }
  }
  return result
}

function updateActorFromSnapshot(
  actor: Actor,
  previous: StatusModifierSnapshot | undefined,
  next: StatusModifierSnapshot | undefined,
) {
  const cache = ensureModifierCache(actor)

  applyStatDelta(actor, 'atk', previous?.atk ?? 0, next?.atk ?? 0)
  applyStatDelta(actor, 'def', previous?.def ?? 0, next?.def ?? 0)

  applyRecordDelta(cache.damageTakenPct, previous?.damageTakenPct, next?.damageTakenPct)
  applyRecordDelta(cache.damageDealtPct, previous?.damageDealtPct, next?.damageDealtPct)
  applyRecordDelta(
    cache.resourceRegenPerTurn as Record<string, number>,
    previous?.resourceRegenPerTurn,
    next?.resourceRegenPerTurn,
  )

  cache.dodgeBonus += (next?.dodgeBonus ?? 0) - (previous?.dodgeBonus ?? 0)
  cache.critChanceBonus += (next?.critChanceBonus ?? 0) - (previous?.critChanceBonus ?? 0)
}

function ensureModifierCache(actor: Actor): ActorStatusModifierCache {
  if (!actor.statusModifiers) {
    actor.statusModifiers = {
      damageTakenPct: {},
      damageDealtPct: {},
      resourceRegenPerTurn: {},
      dodgeBonus: 0,
      critChanceBonus: 0,
    }
  }
  return actor.statusModifiers
}

function cloneResourceRegenMap(
  source: Partial<Record<Resource, number>> | undefined,
): Partial<Record<Resource, number>> | undefined {
  if (!source) {
    return undefined
  }

  const copy: Partial<Record<Resource, number>> = {}
  let hasValue = false
  for (const [key, value] of Object.entries(source)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric === 0) {
      continue
    }
    copy[key as Resource] = numeric
    hasValue = true
  }

  return hasValue ? copy : undefined
}

function applyResourceRegen(
  actor: Actor,
  regen: Partial<Record<Resource, number>> | undefined,
): void {
  if (!regen) {
    return
  }

  for (const [resource, amount] of Object.entries(regen) as [Resource, number][]) {
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric === 0) {
      continue
    }

    const [valueKey, maxKey] = resourceKeys(resource)
    const current = actor.stats[valueKey]
    const max = actor.stats[maxKey]
    const next = clamp(current + numeric, 0, max)
    actor.stats[valueKey] = next
  }
}

function applyStatDelta(actor: Actor, stat: 'atk' | 'def', previous: number, next: number) {
  const delta = next - previous
  if (delta === 0) {
    return
  }
  const value = Math.max(0, (actor.stats[stat] ?? 0) + delta)
  actor.stats[stat] = value
}

function applyRecordDelta(
  cache: Record<string, number>,
  previous?: Record<string, number>,
  next?: Record<string, number>,
) {
  if (previous) {
    for (const [key, value] of Object.entries(previous)) {
      adjustCacheValue(cache, key, -value)
    }
  }
  if (next) {
    for (const [key, value] of Object.entries(next)) {
      adjustCacheValue(cache, key, value)
    }
  }
}

function adjustCacheValue(cache: Record<string, number>, key: string, delta: number) {
  const current = cache[key] ?? 0
  const next = current + delta
  if (Math.abs(next) < 1e-8) {
    delete cache[key]
  } else {
    cache[key] = next
  }
}

function cloneSnapshot(snapshot: StatusModifierSnapshot | undefined): StatusModifierSnapshot | undefined {
  if (!snapshot) {
    return undefined
  }
  const copy: StatusModifierSnapshot = {}
  if (snapshot.atk != null) copy.atk = snapshot.atk
  if (snapshot.def != null) copy.def = snapshot.def
  if (snapshot.damageTakenPct) copy.damageTakenPct = { ...snapshot.damageTakenPct }
  if (snapshot.damageDealtPct) copy.damageDealtPct = { ...snapshot.damageDealtPct }
  if (snapshot.resourceRegenPerTurn) copy.resourceRegenPerTurn = { ...snapshot.resourceRegenPerTurn }
  if (snapshot.dodgeBonus != null) copy.dodgeBonus = snapshot.dodgeBonus
  if (snapshot.critChanceBonus != null) copy.critChanceBonus = snapshot.critChanceBonus
  return copy
}

function resolveEffectValue(
  effect: RuntimeEffect,
  user: Actor,
  target: Actor,
  ctx: StatusFormulaContext,
): { kind: 'number'; amount: number } | { kind: 'none' } {
  const resolver: ValueResolver = effect.value.resolve
  try {
    const raw = resolver(user, target, ctx)
    const amount = normalizeAmount(raw, effect.value.kind, target, effect)
    return { kind: 'number', amount }
  } catch (error) {
    pushLog(
      ctx.state,
      `Status ${ctx.status.name ?? ctx.status.id} failed to resolve value: ${(error as Error).message}`,
    )
    return { kind: 'none' }
  }
}

function normalizeAmount(
  value: number,
  kind: RuntimeEffect['value']['kind'],
  target: Actor,
  effect: RuntimeEffect,
): number {
  const safe = Number.isFinite(value) ? value : 0
  if (kind === 'percent') {
    if (effect.kind === 'resource' && effect.resource) {
      const [, maxKey] = resourceKeys(effect.resource)
      const maxValue = target.stats[maxKey]
      return safe * maxValue
    }
    return safe * target.stats.maxHp
  }
  return safe
}

function applyHookEffect(
  state: BattleState,
  template: RuntimeStatusTemplate,
  effect: RuntimeEffect,
  source: Actor,
  target: Actor,
  ctx: StatusFormulaContext,
) {
  if (!SUPPORTED_KINDS.has(effect.kind)) {
    return
  }

  const resolved = resolveEffectValue(effect, source, target, ctx)
  if (resolved.kind === 'none') {
    return
  }

  const amount = resolved.amount
  switch (effect.kind) {
    case 'damage': {
      const element = effect.element ?? template.modifiers?.shield?.element
      const finalAmount = amount * elementMult(element, target) * tagResistMult(target)
      applyStatusDamage(state, template, target, finalAmount, element)
      break
    }
    case 'heal':
      applyStatusHeal(state, template, target, amount)
      break
    case 'resource':
      if (effect.resource) {
        applyStatusResource(state, template, target, amount, effect.resource)
      }
      break
    default:
      break
  }
}

function applyStatusDamage(
  state: BattleState,
  template: RuntimeStatusTemplate,
  target: Actor,
  amount: number,
  element?: string,
) {
  if (!target.alive) {
    return
  }
  const elementKey = element ?? 'neutral'
  const dmgMult = modifierMultiplier(target.statusModifiers?.damageTakenPct, [elementKey, 'damage'])
  const dmg = Math.max(0, amount * dmgMult)
  if (dmg <= 0) {
    return
  }

  const before = target.stats.hp
  const after = Math.max(0, before - dmg)
  target.stats.hp = after
  if (after <= 0) {
    target.alive = false
  }
  const diff = before - after
  const label = template.name ?? template.id
  let entry = `${target.name} suffers ${Math.round(diff)} damage from ${label}.`
  if (!target.alive) {
    entry += ` ${target.name} was defeated.`
  }
  pushLog(state, entry)
}

function applyStatusHeal(state: BattleState, template: RuntimeStatusTemplate, target: Actor, amount: number) {
  const healMult = modifierMultiplier(target.statusModifiers?.damageTakenPct, ['heal'])
  const heal = Math.max(0, amount) * healMult
  if (heal <= 0) {
    return
  }
  const before = target.stats.hp
  const after = Math.min(target.stats.maxHp, before + heal)
  target.stats.hp = after
  if (after > 0) {
    target.alive = true
  }
  const diff = after - before
  const label = template.name ?? template.id
  pushLog(state, `${target.name} recovers ${Math.round(diff)} HP from ${label}.`)
}

function applyStatusResource(
  state: BattleState,
  template: RuntimeStatusTemplate,
  target: Actor,
  amount: number,
  resource: 'hp' | 'sta' | 'mp',
) {
  const categories = ['resource', `resource:${resource}`]
  const scaledAmount = amount * modifierMultiplier(target.statusModifiers?.damageTakenPct, categories)
  const [currentKey, maxKey] = resourceKeys(resource)
  const before = target.stats[currentKey]
  const max = target.stats[maxKey]
  const after = clamp(before + scaledAmount, 0, max)
  target.stats[currentKey] = after
  const diff = after - before
  const label = template.name ?? template.id
  if (diff === 0) {
    pushLog(state, `${label} affected ${target.name}'s ${resource.toUpperCase()}, but nothing changed.`)
  } else if (diff > 0) {
    pushLog(state, `${target.name} gains ${Math.round(diff)} ${resource.toUpperCase()} from ${label}.`)
  } else {
    pushLog(state, `${target.name} loses ${Math.round(Math.abs(diff))} ${resource.toUpperCase()} from ${label}.`)
  }
}

function modifierMultiplier(
  map: Record<string, number> | undefined,
  categories: (string | undefined)[],
): number {
  if (!map) {
    return 1
  }
  const keys: string[] = ['all', ...categories.filter((key): key is string => Boolean(key))]
  let total = 0
  const seen = new Set<string>()
  for (const key of keys) {
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    const value = map[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value
    }
  }
  const result = 1 + total
  return result < 0 ? 0 : result
}

function resolveDuration(turns: number, template: RuntimeStatusTemplate): number {
  const explicit = Number.isFinite(turns) ? Math.floor(turns) : NaN
  if (explicit && explicit > 0) {
    return explicit
  }
  const fallback = template.durationTurns
  if (fallback == null) {
    return 0
  }
  return Math.max(0, Math.floor(fallback))
}

function ensureStatuses(actor: Actor): ActiveStatus[] {
  if (!Array.isArray(actor.statuses)) {
    actor.statuses = []
  }
  actor.statuses = actor.statuses.map((entry) => ({
    id: entry.id,
    turns: entry.turns,
    stacks: Math.max(1, entry.stacks ?? 1),
    sourceId: (entry as ActiveStatus).sourceId,
    appliedModifiers: cloneSnapshot((entry as ActiveStatus).appliedModifiers),
  }))
  return actor.statuses as ActiveStatus[]
}

function resolveSourceActor(state: BattleState, sourceId: string | undefined): Actor | undefined {
  if (!sourceId) {
    return undefined
  }
  return state.actors[sourceId]
}

function ensureShieldMap(state: BattleState, actorId: string): Record<string, { id: string; hp: number; element?: string }> {
  const existing = state.shields[actorId]
  if (existing) {
    return existing
  }
  state.shields[actorId] = {}
  return state.shields[actorId]
}

function resourceKeys(resource: 'hp' | 'sta' | 'mp'): ['hp' | 'sta' | 'mp', 'maxHp' | 'maxSta' | 'maxMp'] {
  switch (resource) {
    case 'sta':
      return ['sta', 'maxSta']
    case 'mp':
      return ['mp', 'maxMp']
    case 'hp':
    default:
      return ['hp', 'maxHp']
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function pushLog(state: BattleState, message: string) {
  state.log.push(message)
}

const SUPPORTED_KINDS = new Set<RuntimeEffect['kind']>(['damage', 'heal', 'resource'])
