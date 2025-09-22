
import type {
  FormulaContext,
  RuntimeEffect,
  RuntimeItem,
  RuntimeSkill,
  RuntimeTargetSelector,
  ValueResolver,
} from '@content/adapters'
import type { ConditionOp, Filter, Resource } from '@config/schema'
import { CONFIG } from '@config/store'

import { resolveTargets } from './targeting'
import { critChance, elementMult, hitChance, tagResistMult, type RuleContext } from './rules'
import type { Actor, BattleState, UseResult } from './types'

const RNG_A = 1664525
const RNG_C = 1013904223
const RNG_M = 0x100000000

type RuntimeAction = RuntimeSkill | RuntimeItem

export function useSkill(
  state: BattleState,
  skill: RuntimeSkill,
  userId: string,
  targetIds?: string[],
): UseResult {
  return executeAction(state, skill, userId, targetIds)
}

export function useItem(
  state: BattleState,
  item: RuntimeItem,
  userId: string,
  targetIds?: string[],
): UseResult {
  return executeAction(state, item, userId, targetIds)
}

export function endTurn(state: BattleState): BattleState {
  if (state.ended) {
    return state
  }

  const currentActorId = state.order[state.current]
  const actor = currentActorId ? state.actors[currentActorId] : undefined
  if (actor) {
    pushLog(state, `${actor.name} ended their turn.`)
  }

  state.current = (state.current + 1) % (state.order.length || 1)
  if (state.current === 0) {
    state.turn += 1
    pushLog(state, `Turn ${state.turn} begins.`)
  }
  return state
}

type ActionFormulaContext = FormulaContext & { state: BattleState; action: RuntimeAction }

type DamageOptions = {
  crit?: boolean
}

function executeAction(
  state: BattleState,
  action: RuntimeAction,
  userId: string,
  providedTargetIds?: string[],
): UseResult {
  if (state.ended) {
    pushLog(state, 'The battle is already over.')
    return { ok: false, log: state.log, state }
  }

  const user = state.actors[userId]
  if (!user) {
    pushLog(state, `Unknown actor ${userId} tried to use ${action.name}.`)
    return { ok: false, log: state.log, state }
  }

  if (!user.alive) {
    pushLog(state, `${user.name} cannot act while defeated.`)
    return { ok: false, log: state.log, state }
  }

  if (!payResourceCost(user, action.costs?.sta ?? 0, 'sta', state, action.name)) {
    return { ok: false, log: state.log, state }
  }

  if (!payResourceCost(user, action.costs?.mp ?? 0, 'mp', state, action.name)) {
    return { ok: false, log: state.log, state }
  }

  const baseTargetIds =
    providedTargetIds && providedTargetIds.length
      ? providedTargetIds
      : resolveTargets(state, normalizeSelector(action.targeting), userId)

  const baseTargets = filterActors(state, baseTargetIds)

  if (baseTargets.length === 0) {
    pushLog(state, `${action.name} has no valid targets.`)
  }

  pushLog(state, `${user.name} used ${action.name}.`)

  for (const effect of action.effects ?? []) {
    const selector = effect.selector ?? action.targeting
    const targets = effect.selector
      ? filterActors(state, resolveTargets(state, normalizeSelector(selector), userId))
      : baseTargets

    if (targets.length === 0) {
      continue
    }

    for (const target of targets) {
      applyEffect(state, action, effect, user, target)
    }
  }

  evaluateOutcome(state)
  return { ok: true, log: state.log, state }
}

function normalizeSelector(selector: RuntimeTargetSelector): RuntimeTargetSelector {
  const includeDead = selector.includeDead ?? false
  const count = selector.count ?? (selector.mode === 'random' ? 1 : undefined)
  return { ...selector, includeDead, count }
}

function filterActors(state: BattleState, ids: string[]): Actor[] {
  return ids
    .map((id) => state.actors[id])
    .filter((actor): actor is Actor => Boolean(actor))
}

function payResourceCost(
  actor: Actor,
  cost: number,
  resource: 'sta' | 'mp',
  state: BattleState,
  actionName: string,
): boolean {
  const amount = Math.max(0, cost ?? 0)
  if (amount === 0) {
    return true
  }

  const key = resource
  const current = actor.stats[key]
  if (current < amount) {
    pushLog(
      state,
      `Not enough ${resource.toUpperCase()} to use ${actionName} (need ${amount}, have ${current}).`,
    )
    return false
  }

  actor.stats[key] = current - amount
  return true
}

function applyEffect(
  state: BattleState,
  action: RuntimeAction,
  effect: RuntimeEffect,
  user: Actor,
  target: Actor,
) {
  if (effect.onlyIf && !matchesFilter(target, effect.onlyIf)) {
    return
  }

  const ctx: ActionFormulaContext = { state, action }
  const base = resolveValue(effect.value.resolve, effect.value.kind, user, target, ctx, effect, action)
  const amount = base.kind === 'none' ? 0 : base.amount
  const ruleCtx: RuleContext = { state, action, effect }

  switch (effect.kind) {
    case 'damage': {
      if (effect.canMiss) {
        const roll = nextRandom(state)
        const chance = clamp(hitChance(user, target, ruleCtx), 0, 1)
        if (roll > chance) {
          pushLog(state, `${user.name}'s ${action.name} missed ${target.name}.`)
          return
        }
      }

      const element = effect.element ?? action.element
      let finalAmount = amount * elementMult(element, target) * tagResistMult(target)
      let crit = false

      if (effect.canCrit) {
        const chance = clamp(critChance(user, target, ruleCtx), 0, 1)
        const roll = nextRandom(state)
        if (roll < chance) {
          const { CRIT_MULT } = CONFIG().balance
          finalAmount *= CRIT_MULT
          crit = true
        }
      }

      applyDamage(state, user, target, finalAmount, { crit })
      break
    }
    case 'heal':
      applyHeal(state, user, target, amount)
      break
    case 'resource':
      if (effect.resource) {
        applyResource(state, user, target, amount, effect.resource)
      }
      break
    default:
      // unsupported kinds will be ignored in this phase
      break
  }
}

function resolveValue(
  resolver: ValueResolver,
  kind: RuntimeEffect['value']['kind'],
  user: Actor,
  target: Actor,
  ctx: ActionFormulaContext,
  effect: RuntimeEffect,
  action: RuntimeAction,
): { kind: 'number'; amount: number } | { kind: 'none' } {
  try {
    const resolved = resolver(user, target, ctx)
    const amount = normalizeAmount(resolved, kind, target, effect)
    return { kind: 'number', amount }
  } catch (error) {
    pushLog(
      ctx.state,
      `Failed to resolve value for ${action.name}: ${(error as Error).message}`,
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

function applyDamage(
  state: BattleState,
  user: Actor,
  target: Actor,
  amount: number,
  options: DamageOptions = {},
) {
  if (!target.alive) {
    return
  }
  const dmg = Math.max(0, amount)
  const before = target.stats.hp
  const after = Math.max(0, before - dmg)
  target.stats.hp = after
  if (after <= 0) {
    target.alive = false
  }
  const diff = before - after
  let entry = `${user.name} hit ${target.name} for ${Math.round(diff)} damage.`
  if (options.crit) {
    entry += ' Critical hit!'
  }
  if (after <= 0) {
    entry += ` ${target.name} was defeated.`
  }
  pushLog(state, entry)
}

function applyHeal(state: BattleState, user: Actor, target: Actor, amount: number) {
  const heal = Math.max(0, amount)
  const before = target.stats.hp
  const after = Math.min(target.stats.maxHp, before + heal)
  target.stats.hp = after
  if (after > 0) {
    target.alive = true
  }
  const diff = after - before
  pushLog(state, `${user.name} healed ${target.name} for ${Math.round(diff)} HP.`)
}

function applyResource(
  state: BattleState,
  user: Actor,
  target: Actor,
  amount: number,
  resource: Resource,
) {
  const [currentKey, maxKey] = resourceKeys(resource)
  const before = target.stats[currentKey]
  const max = target.stats[maxKey]
  const after = clamp(before + amount, 0, max)
  target.stats[currentKey] = after
  const diff = after - before
  const label = resource.toUpperCase()
  if (diff === 0) {
    pushLog(state, `${user.name} affected ${target.name}'s ${label}, but nothing changed.`)
  } else if (diff > 0) {
    pushLog(state, `${user.name} restored ${Math.round(diff)} ${label} to ${target.name}.`)
  } else {
    pushLog(state, `${user.name} drained ${Math.round(Math.abs(diff))} ${label} from ${target.name}.`)
  }
}

function resourceKeys(resource: Resource): ['hp' | 'sta' | 'mp', 'maxHp' | 'maxSta' | 'maxMp'] {
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

function nextRandom(state: BattleState): number {
  const seed = state.rngSeed >>> 0
  const next = (Math.imul(seed, RNG_A) + RNG_C) >>> 0
  state.rngSeed = next
  return next / RNG_M
}

function evaluateOutcome(state: BattleState) {
  if (state.ended) {
    return
  }
  const enemiesAlive = state.sideEnemy.some((id) => state.actors[id]?.alive)
  if (!enemiesAlive) {
    state.ended = { reason: 'victory' }
    pushLog(state, 'Victory!')
    return
  }
  const playersAlive = state.sidePlayer.some((id) => state.actors[id]?.alive)
  if (!playersAlive) {
    state.ended = { reason: 'defeat' }
    pushLog(state, 'Defeat...')
  }
}

function matchesFilter(actor: Actor, filter: Filter): boolean {
  if (filter.all && !filter.all.every((inner) => matchesFilter(actor, inner))) {
    return false
  }
  if (filter.any && !filter.any.some((inner) => matchesFilter(actor, inner))) {
    return false
  }
  if (filter.not && matchesFilter(actor, filter.not)) {
    return false
  }
  if (!filter.test) {
    return true
  }
  const { key, op, value } = filter.test
  switch (key) {
    case 'hpPct':
      return compareNumeric(fraction(actor.stats.hp, actor.stats.maxHp), op, value)
    case 'staPct':
      return compareNumeric(fraction(actor.stats.sta, actor.stats.maxSta), op, value)
    case 'mpPct':
      return compareNumeric(fraction(actor.stats.mp, actor.stats.maxMp), op, value)
    case 'atk':
      return compareNumeric(actor.stats.atk, op, value)
    case 'def':
      return compareNumeric(actor.stats.def, op, value)
    case 'lv':
      return compareNumeric(actor.stats.lv, op, value)
    case 'hasStatus':
      return compareSet(actor.statuses.map((entry) => entry.id), op, value)
    case 'tag':
      return compareSet(actor.tags ?? [], op, value)
    case 'clazz':
      return compareValue(actor.clazz ?? null, op, value)
    default:
      return false
  }
}

function compareNumeric(actual: number, op: ConditionOp, expected: unknown): boolean {
  if (op === 'in' || op === 'notIn') {
    const values = Array.isArray(expected) ? expected : [expected]
    const parsed = values
      .map((value) => (typeof value === 'number' ? value : Number(value)))
      .filter((num) => Number.isFinite(num))
    const has = parsed.some((num) => num === actual)
    return op === 'in' ? has : !has
  }

  const expectedNumber = typeof expected === 'number' ? expected : Number(expected)
  if (!Number.isFinite(expectedNumber)) {
    return false
  }

  switch (op) {
    case 'lt':
      return actual < expectedNumber
    case 'lte':
      return actual <= expectedNumber
    case 'eq':
      return actual === expectedNumber
    case 'gte':
      return actual >= expectedNumber
    case 'gt':
      return actual > expectedNumber
    case 'ne':
      return actual !== expectedNumber
    default:
      return false
  }
}

function compareValue(actual: unknown, op: ConditionOp, expected: unknown): boolean {
  if (op === 'in' || op === 'notIn') {
    const values = Array.isArray(expected) ? expected : [expected]
    const has = values.some((entry) => entry === actual)
    return op === 'in' ? has : !has
  }
  switch (op) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    default:
      return false
  }
}

function compareSet(actual: string[], op: ConditionOp, expected: unknown): boolean {
  const values = Array.isArray(expected) ? expected : [expected]
  const hasAny = values.some((entry) => actual.includes(entry))
  if (op === 'in') {
    return hasAny
  }
  if (op === 'notIn') {
    return !hasAny
  }
  if (op === 'eq') {
    return hasAny
  }
  if (op === 'ne') {
    return !hasAny
  }
  return false
}

function fraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0
  }
  return value / max
}

function pushLog(state: BattleState, entry: string) {
  state.log.push(entry)
}
