import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeEffect, RuntimeSkill, RuntimeTargetSelector } from '@content/adapters'
import { DEFAULTS } from '@config/defaults'
import * as configStore from '@config/store'
import { critChance, elementMult, hitChance, tagResistMult, type RuleContext } from '@engine/battle/rules'
import type { Actor, BattleState } from '@engine/battle/types'

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS))
}

function makeActor(id: string, overrides: Partial<Actor['stats']> = {}, tags: string[] = []): Actor {
  return {
    id,
    name: id,
    stats: {
      maxHp: 100,
      hp: 100,
      maxSta: 20,
      sta: 20,
      maxMp: 10,
      mp: 10,
      atk: 10,
      def: 5,
      lv: 1,
      xp: 0,
      gold: 0,
      ...overrides,
    },
    statuses: [],
    alive: true,
    tags,
  }
}

function makeContext(): RuleContext {
  const targeting: RuntimeTargetSelector = {
    side: 'enemy',
    mode: 'single',
    includeDead: false,
  }
  const effect: RuntimeEffect = {
    kind: 'damage',
    value: {
      kind: 'flat',
      resolve: () => 0,
    },
    canCrit: false,
    canMiss: false,
    sharedAccuracyRoll: true,
  }
  const action: RuntimeSkill = {
    id: 'skill',
    type: 'skill',
    name: 'Skill',
    targeting,
    effects: [effect],
    costs: { sta: 0, mp: 0, cooldown: 0 },
    aiWeight: 1,
  }
  const state: BattleState = {
    rngSeed: 1,
    actors: {},
    sidePlayer: [],
    sideEnemy: [],
    inventory: [],
    order: [],
    current: 0,
    turn: 1,
    log: [],
  }
  return { state, action, effect }
}

let configSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  configSpy = vi.spyOn(configStore, 'CONFIG')
})

afterEach(() => {
  configSpy.mockRestore()
  vi.restoreAllMocks()
})

function mockConfig(overrides: Partial<typeof DEFAULTS.balance>) {
  const cfg = cloneDefaults()
  cfg.balance = { ...cfg.balance, ...overrides }
  configSpy.mockReturnValue(cfg)
  return cfg
}

describe('battle rules', () => {
  it('clamps hit chance within configured bounds', () => {
    mockConfig({ BASE_HIT: 1.2, DODGE_FLOOR: 0.1, HIT_CEIL: 0.95 })
    const ctx = makeContext()
    const attacker = makeActor('A', { atk: 80, lv: 10 })
    const defender = makeActor('B', { def: 5, lv: 1 })
    expect(hitChance(attacker, defender, ctx)).toBeCloseTo(0.95)

    mockConfig({ BASE_HIT: -0.4, DODGE_FLOOR: 0.15, HIT_CEIL: 0.9 })
    const weakAttacker = makeActor('C', { atk: 1, lv: 1 })
    const strongDefender = makeActor('D', { def: 50, lv: 20 })
    expect(hitChance(weakAttacker, strongDefender, ctx)).toBeCloseTo(0.15)
  })

  it('returns crit chance influenced by stats and clamped to one', () => {
    mockConfig({ BASE_CRIT: 0.4 })
    const ctx = makeContext()
    const attacker = makeActor('A', { atk: 120, lv: 50 })
    const defender = makeActor('B', { def: 5, lv: 1 })
    expect(critChance(attacker, defender, ctx)).toBeCloseTo(1)
  })

  it('applies element multipliers using the configured matrix', () => {
    mockConfig({
      ELEMENT_MATRIX: {
        fire: { neutral: 1, slime: 2 },
        neutral: { neutral: 1 },
      },
    })
    const slime = makeActor('slime', {}, ['slime'])
    expect(elementMult('fire', slime)).toBe(2)
    expect(elementMult('ice', slime)).toBe(1)
  })

  it('multiplies tag resistances from the balance table', () => {
    mockConfig({ RESISTS_BY_TAG: { slime: 0.5, armored: 0.8 } })
    const target = makeActor('boss', {}, ['slime', 'armored'])
    expect(tagResistMult(target)).toBeCloseTo(0.4)
  })
})
