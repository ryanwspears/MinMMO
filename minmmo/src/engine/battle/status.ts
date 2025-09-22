import type {
  FormulaContext,
  RuntimeEffect,
  RuntimeStatusTemplate,
  ValueResolver,
} from '@content/adapters'
import { Statuses } from '@content/registry'
import { elementMult, tagResistMult } from './rules'
import type { Actor, BattleState, Status } from './types'

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

interface StatusFormulaContext extends FormulaContext {
  state: BattleState
  status: RuntimeStatusTemplate
  entry: ActiveStatus
  source: Actor
  event?: StatusEventContext
}

interface HookOptions {
  other?: Actor
  amount?: number
  element?: string
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

export function tickEndOfTurn(state: BattleState, actorOrId: string | Actor): void {
  const actor = typeof actorOrId === 'string' ? state.actors[actorOrId] : actorOrId
  if (!actor) {
    return
  }

  const statuses = ensureStatuses(actor)
  if (statuses.length === 0 && !state.taunts[actor.id]) {
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
    runHookForEntry(state, actor, template, entry, hook, options)
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
      applyStatusDamage(state, template, target, finalAmount)
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

function applyStatusDamage(state: BattleState, template: RuntimeStatusTemplate, target: Actor, amount: number) {
  if (!target.alive) {
    return
  }
  const dmg = Math.max(0, amount)
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
  const heal = Math.max(0, amount)
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
  const [currentKey, maxKey] = resourceKeys(resource)
  const before = target.stats[currentKey]
  const max = target.stats[maxKey]
  const after = clamp(before + amount, 0, max)
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
