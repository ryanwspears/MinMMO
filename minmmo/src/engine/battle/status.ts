import type {
  FormulaContext,
  RuntimeEffect,
  RuntimeStatusTemplate,
  ValueResolver,
} from '@content/adapters'
import { Statuses } from '@content/registry'
import { elementMult, tagResistMult } from './rules'
import type { Actor, BattleState, Status } from './types'

interface StatusApplyOptions {
  stacks?: number
  sourceId?: string
}

interface ActiveStatus extends Status {
  stacks: number
  sourceId?: string
}

interface StatusFormulaContext extends FormulaContext {
  state: BattleState
  status: RuntimeStatusTemplate
  entry: ActiveStatus
  source: Actor
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
  const existing = active.find((entry) => entry.id === statusId)
  const name = template.name ?? template.id

  if (existing) {
    switch (template.stackRule) {
      case 'ignore':
        pushLog(state, `${name} is already affecting ${target.name}.`)
        return
      case 'stackCount':
        existing.stacks = clamp(existing.stacks + stacksToAdd, 1, template.maxStacks ?? Infinity)
        existing.turns = duration
        break
      case 'renew':
      default:
        existing.turns = duration
        existing.stacks = clamp(stacksToAdd, 1, template.maxStacks ?? Infinity)
        break
    }
    if (options.sourceId) {
      existing.sourceId = options.sourceId
    }
    pushLog(state, `${target.name}'s ${name} was refreshed (${existing.turns} turns).`)
    return
  }

  const entry: ActiveStatus = {
    id: statusId,
    turns: duration,
    stacks: clamp(stacksToAdd, 1, template.maxStacks ?? Infinity),
  }
  if (options.sourceId) {
    entry.sourceId = options.sourceId
  }

  active.push(entry)
  pushLog(state, `${target.name} is afflicted by ${name} for ${duration} turns.`)
}

export function tickEndOfTurn(state: BattleState, actorOrId: string | Actor): void {
  const actor = typeof actorOrId === 'string' ? state.actors[actorOrId] : actorOrId
  if (!actor) {
    return
  }

  const statuses = ensureStatuses(actor)
  if (statuses.length === 0) {
    return
  }

  const next: ActiveStatus[] = []
  for (const entry of statuses) {
    const template = Statuses()[entry.id]
    if (!template) {
      continue
    }

    runEffects(state, template, entry, actor)

    entry.turns -= 1
    if (entry.turns > 0) {
      next.push(entry)
    } else {
      pushLog(state, `${template.name ?? template.id} expired on ${actor.name}.`)
    }
  }

  actor.statuses = next
}

function runEffects(
  state: BattleState,
  template: RuntimeStatusTemplate,
  entry: ActiveStatus,
  actor: Actor,
) {
  if (!actor.alive) {
    return
  }

  const hooks = template.hooks?.onTurnEnd ?? []
  if (hooks.length === 0) {
    return
  }

  const source = resolveSourceActor(state, entry.sourceId) ?? actor
  const ctx: StatusFormulaContext = {
    state,
    status: template,
    entry,
    source,
  }

  for (const effect of hooks) {
    applyHookEffect(state, template, effect, source, actor, ctx)
  }
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

