
import type {
  CompareKey,
  ConditionOp,
  Filter,
  TargetSelector,
} from '@config/schema'

import type { Actor, BattleState } from './types'

const RNG_A = 1664525
const RNG_C = 1013904223
const RNG_M = 0x100000000

export function getEnemies(state: BattleState): Actor[] {
  return (state.sideEnemy ?? []).map((id) => state.actors[id]).filter(Boolean) as Actor[]
}

export function getAllies(state: BattleState): Actor[] {
  return (state.sidePlayer ?? []).map((id) => state.actors[id]).filter(Boolean) as Actor[]
}

export function resolveTargets(
  state: BattleState,
  selector: TargetSelector,
  userId: string,
): string[] {
  const user = state.actors[userId]
  if (!user) {
    return []
  }

  const includeDead = selector.includeDead ?? false
  const baseCandidates = gatherCandidates(state, selector.side, userId, includeDead)

  if (selector.mode === 'self') {
    return includeDead || user.alive ? [userId] : []
  }

  let candidates = selector.condition
    ? baseCandidates.filter((actor) => matchesFilter(actor, selector.condition!))
    : baseCandidates

  if (!includeDead) {
    candidates = candidates.filter((actor) => actor.alive)
  }

  if (candidates.length === 0) {
    return []
  }

  switch (selector.mode) {
    case 'single':
      return [candidates[0].id]
    case 'all':
      return candidates.map((actor) => actor.id)
    case 'random':
      return pickRandom(state, candidates, normalizeCount('random', selector.count)).map(
        (actor) => actor.id,
      )
    case 'lowest':
    case 'highest': {
      const sorted = sortByMetric(candidates, selector.ofWhat, selector.mode === 'lowest')
      const limit = normalizeCount(selector.mode, selector.count)
      return sorted.slice(0, limit || 1).map((actor) => actor.id)
    }
    case 'condition':
      return candidates
        .slice(0, selector.count != null ? Math.max(0, selector.count) : candidates.length)
        .map((actor) => actor.id)
    default:
      return includeDead || user.alive ? [userId] : []
  }
}

function gatherCandidates(
  state: BattleState,
  side: TargetSelector['side'],
  userId: string,
  includeDead: boolean,
): Actor[] {
  const user = state.actors[userId]
  const sameSide = state.sidePlayer.includes(userId) ? state.sidePlayer : state.sideEnemy
  const oppositeSide = sameSide === state.sidePlayer ? state.sideEnemy : state.sidePlayer

  const fromIds = (ids: string[]): Actor[] =>
    ids
      .map((id) => state.actors[id])
      .filter((actor): actor is Actor => Boolean(actor) && (includeDead || actor.alive))

  switch (side) {
    case 'self':
      return includeDead || user?.alive ? [user].filter(Boolean) as Actor[] : []
    case 'ally':
      return fromIds(sameSide)
    case 'enemy':
      return fromIds(oppositeSide)
    case 'any':
      return [...fromIds(sameSide), ...fromIds(oppositeSide)]
    default:
      return []
  }
}

export function matchesFilter(actor: Actor, filter: Filter): boolean {
  let result = true

  if (filter.test) {
    result = result && evaluateTest(actor, filter.test)
  }

  if (filter.all) {
    result = result && filter.all.every((inner) => matchesFilter(actor, inner))
  }

  if (filter.any) {
    result = result && filter.any.some((inner) => matchesFilter(actor, inner))
  }

  if (filter.not) {
    result = result && !matchesFilter(actor, filter.not)
  }

  return result
}

function evaluateTest(
  actor: Actor,
  test: NonNullable<Filter['test']>,
): boolean {
  const { key, op, value } = test
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
      return compareSet(
        actor.statuses.map((entry) => entry.id),
        op,
        value,
      )
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
    const numbers = values
      .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
      .filter((entry) => Number.isFinite(entry))
    const has = numbers.some((entry) => entry === actual)
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
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      if (typeof actual === 'number' && typeof expected === 'number') {
        return compareNumeric(actual, op, expected)
      }
      return false
    default:
      return false
  }
}

function compareSet(actual: string[], op: ConditionOp, expected: unknown): boolean {
  const values = Array.isArray(expected) ? expected : [expected]
  const cleaned = values.filter((entry): entry is string => typeof entry === 'string')

  switch (op) {
    case 'eq':
      return cleaned.every((entry) => actual.includes(entry))
    case 'ne':
      return cleaned.every((entry) => !actual.includes(entry))
    case 'in':
      return cleaned.some((entry) => actual.includes(entry))
    case 'notIn':
      return cleaned.every((entry) => !actual.includes(entry))
    default:
      return false
  }
}

function normalizeCount(mode: TargetSelector['mode'], provided?: number): number {
  if (provided != null) {
    return Math.max(0, provided)
  }
  switch (mode) {
    case 'single':
      return 1
    case 'random':
      return 1
    case 'lowest':
    case 'highest':
      return 1
    default:
      return 0
  }
}

function fraction(current: number, max: number): number {
  if (max <= 0) return 0
  return current / max
}

function sortByMetric(actors: Actor[], key: CompareKey | undefined, asc: boolean): Actor[] {
  const metricKey =
    key && ['hpPct', 'staPct', 'mpPct', 'atk', 'def', 'lv'].includes(key) ? key : 'hpPct'
  const scored = actors.map((actor) => ({ actor, value: getMetric(actor, metricKey as CompareKey) }))
  scored.sort((a, b) => (asc ? a.value - b.value : b.value - a.value))
  return scored.map((entry) => entry.actor)
}

function getMetric(actor: Actor, key: CompareKey): number {
  switch (key) {
    case 'hpPct':
      return fraction(actor.stats.hp, actor.stats.maxHp)
    case 'staPct':
      return fraction(actor.stats.sta, actor.stats.maxSta)
    case 'mpPct':
      return fraction(actor.stats.mp, actor.stats.maxMp)
    case 'atk':
      return actor.stats.atk
    case 'def':
      return actor.stats.def
    case 'lv':
      return actor.stats.lv
    default:
      return fraction(actor.stats.hp, actor.stats.maxHp)
  }
}

function pickRandom(state: BattleState, actors: Actor[], count: number): Actor[] {
  if (count <= 0) return []
  const pool = actors.slice()
  const result: Actor[] = []
  while (result.length < count && pool.length > 0) {
    const index = Math.floor(nextRandom(state) * pool.length)
    result.push(pool.splice(index, 1)[0])
  }
  return result
}

function nextRandom(state: BattleState): number {
  const seed = state.rngSeed >>> 0
  const next = (Math.imul(seed, RNG_A) + RNG_C) >>> 0
  state.rngSeed = next
  return next / RNG_M
}
