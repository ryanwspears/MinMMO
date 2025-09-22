import { CONFIG } from '@config/store'
import type { RuntimeEffect, RuntimeItem, RuntimeSkill } from '@content/adapters'
import type { Actor, BattleState } from './types'

export interface RuleContext {
  state: BattleState
  action: RuntimeSkill | RuntimeItem
  effect: RuntimeEffect
}

export function hitChance(user: Actor, target: Actor, _ctx: RuleContext): number {
  const { balance } = CONFIG()
  const levelDiff = (user.stats.lv - target.stats.lv) * 0.02
  const statDiff = (user.stats.atk - target.stats.def) * 0.01
  const raw = balance.BASE_HIT + levelDiff + statDiff
  return clamp(raw, balance.DODGE_FLOOR, balance.HIT_CEIL)
}

export function critChance(user: Actor, target: Actor, _ctx: RuleContext): number {
  const { balance } = CONFIG()
  const levelBonus = Math.max(0, user.stats.lv - target.stats.lv) * 0.01
  const statBonus = Math.max(0, user.stats.atk - target.stats.def) * 0.005
  const raw = balance.BASE_CRIT + levelBonus + statBonus
  return clamp(raw, 0, 1)
}

export function elementMult(element: string | undefined, target: Actor): number {
  if (!element) {
    return 1
  }
  const { balance } = CONFIG()
  const table = balance.ELEMENT_MATRIX[element]
  if (!table) {
    return 1
  }

  const tags = target.tags ?? []
  for (const tag of tags) {
    const value = table[tag]
    if (typeof value === 'number') {
      return value
    }
  }

  return typeof table.neutral === 'number' ? table.neutral : 1
}

export function tagResistMult(target: Actor): number {
  const { balance } = CONFIG()
  const resists = balance.RESISTS_BY_TAG
  if (!target.tags || target.tags.length === 0) {
    return 1
  }

  return target.tags.reduce((acc, tag) => {
    const value = resists[tag]
    return typeof value === 'number' ? acc * value : acc
  }, 1)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) return min
  if (value > max) return max
  return value
}
