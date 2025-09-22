import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeEffect, RuntimeStatusTemplate } from '@content/adapters'
import { applyStatus, tickEndOfTurn } from '@engine/battle/status'
import { createState } from '@engine/battle/state'
import type { Actor, BattleState } from '@engine/battle/types'
import { DEFAULTS } from '@config/defaults'
import * as configStore from '@config/store'
import * as registry from '@content/registry'

function makeActor(id: string, overrides: Partial<Actor['stats']> = {}): Actor {
  return {
    id,
    name: id,
    stats: {
      maxHp: 40,
      hp: 40,
      maxSta: 10,
      sta: 10,
      maxMp: 8,
      mp: 8,
      atk: 6,
      def: 4,
      lv: 1,
      xp: 0,
      gold: 0,
      ...overrides,
    },
    statuses: [],
    alive: true,
    tags: ['player'],
  }
}

function makeState(actor: Actor): BattleState {
  return createState({
    rngSeed: 123,
    actors: { [actor.id]: actor },
    sidePlayer: [actor.id],
    sideEnemy: [],
    inventory: [],
  })
}

function flatEffect(kind: RuntimeEffect['kind'], amount: number): RuntimeEffect {
  return {
    kind,
    value: {
      kind: 'flat',
      resolve: () => amount,
      rawAmount: amount,
    },
    canCrit: false,
    canMiss: false,
  }
}

function statusTemplate(partial: Partial<RuntimeStatusTemplate> & { id: string }): RuntimeStatusTemplate {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    desc: partial.desc,
    icon: partial.icon,
    tags: partial.tags ?? [],
    stackRule: partial.stackRule ?? 'renew',
    maxStacks: partial.maxStacks ?? 1,
    durationTurns: partial.durationTurns ?? 1,
    modifiers: partial.modifiers,
    hooks: partial.hooks ?? {
      onApply: [],
      onTurnStart: [],
      onTurnEnd: [],
      onDealDamage: [],
      onTakeDamage: [],
      onExpire: [],
    },
  }
}

let configSpy: ReturnType<typeof vi.spyOn> | undefined
let statusesSpy: ReturnType<typeof vi.spyOn> | undefined
let registryMap: Record<string, RuntimeStatusTemplate>

describe('status engine - damage over time', () => {
  beforeEach(() => {
    const cfg = JSON.parse(JSON.stringify(DEFAULTS))
    cfg.balance.BASE_HIT = 1
    cfg.balance.BASE_CRIT = 0
    cfg.balance.DODGE_FLOOR = 0
    cfg.balance.HIT_CEIL = 1
    cfg.balance.ELEMENT_MATRIX = { neutral: { neutral: 1 } }
    cfg.balance.RESISTS_BY_TAG = {}
    configSpy = vi.spyOn(configStore, 'CONFIG').mockReturnValue(cfg)

    registryMap = {}
    statusesSpy = vi.spyOn(registry, 'Statuses').mockImplementation(() => registryMap)
  })

  afterEach(() => {
    configSpy?.mockRestore()
    statusesSpy?.mockRestore()
    vi.restoreAllMocks()
  })

  it('ticks onTurnEnd damage and expires after the final turn', () => {
    registryMap.burn = statusTemplate({
      id: 'burn',
      name: 'Burn',
      durationTurns: 3,
      hooks: {
        onApply: [],
        onTurnStart: [],
        onTurnEnd: [flatEffect('damage', 5)],
        onDealDamage: [],
        onTakeDamage: [],
        onExpire: [],
      },
    })

    const actor = makeActor('P1', { hp: 30, maxHp: 30 })
    const state = makeState(actor)

    applyStatus(state, actor.id, 'burn', 3)
    expect(actor.statuses).toHaveLength(1)
    expect(actor.statuses[0]?.turns).toBe(3)

    tickEndOfTurn(state, actor.id)
    expect(actor.stats.hp).toBe(25)
    expect(actor.statuses[0]?.turns).toBe(2)

    tickEndOfTurn(state, actor.id)
    expect(actor.stats.hp).toBe(20)
    expect(actor.statuses[0]?.turns).toBe(1)

    tickEndOfTurn(state, actor.id)
    expect(actor.stats.hp).toBe(15)
    expect(actor.statuses.length).toBe(0)
    expect(state.log.some((line) => line.includes('expired'))).toBe(true)
  })

  it('renew stack rule refreshes duration', () => {
    registryMap.freeze = statusTemplate({
      id: 'freeze',
      name: 'Freeze',
      durationTurns: 4,
      stackRule: 'renew',
      hooks: {
        onApply: [],
        onTurnStart: [],
        onTurnEnd: [],
        onDealDamage: [],
        onTakeDamage: [],
        onExpire: [],
      },
    })

    const actor = makeActor('P1')
    const state = makeState(actor)

    applyStatus(state, actor.id, 'freeze', 2)
    tickEndOfTurn(state, actor.id)
    expect(actor.statuses[0]?.turns).toBe(1)

    applyStatus(state, actor.id, 'freeze', 4)
    expect(actor.statuses[0]?.turns).toBe(4)
    expect(state.log.filter((line) => line.includes('Freeze')).length).toBeGreaterThan(1)
  })

  it('stackCount rule increases stacks up to the template max', () => {
    registryMap.poison = statusTemplate({
      id: 'poison',
      name: 'Poison',
      durationTurns: 3,
      stackRule: 'stackCount',
      maxStacks: 3,
      hooks: {
        onApply: [],
        onTurnStart: [],
        onTurnEnd: [
          {
            kind: 'damage',
            value: {
              kind: 'flat',
              resolve: (_u, _t, ctx) => (ctx.entry.stacks as number) * 2,
            },
            canCrit: false,
            canMiss: false,
          } as RuntimeEffect,
        ],
        onDealDamage: [],
        onTakeDamage: [],
        onExpire: [],
      },
    })

    const actor = makeActor('P1', { hp: 40, maxHp: 40 })
    const state = makeState(actor)

    applyStatus(state, actor.id, 'poison', 3)
    tickEndOfTurn(state, actor.id)
    expect(actor.stats.hp).toBe(38)

    applyStatus(state, actor.id, 'poison', 3)
    expect(actor.statuses[0]?.stacks).toBe(2)
    tickEndOfTurn(state, actor.id)
    expect(actor.stats.hp).toBe(34)

    applyStatus(state, actor.id, 'poison', 3)
    applyStatus(state, actor.id, 'poison', 3)
    expect(actor.statuses[0]?.stacks).toBe(3)
  })

  it('applies selector-based hook effects to all resolved allies', () => {
    registryMap.aura = statusTemplate({
      id: 'aura',
      durationTurns: 2,
      hooks: {
        onApply: [],
        onTurnStart: [],
        onTurnEnd: [
          {
            kind: 'heal',
            value: {
              kind: 'flat',
              resolve: () => 5,
              rawAmount: 5,
            },
            selector: {
              side: 'ally',
              mode: 'all',
              includeDead: true,
              count: 0,
            },
            canCrit: false,
            canMiss: false,
          } as RuntimeEffect,
        ],
        onDealDamage: [],
        onTakeDamage: [],
        onExpire: [],
      },
    })

    const leader = makeActor('P1', { hp: 10, maxHp: 40 })
    const ally = makeActor('P2', { hp: 6, maxHp: 30 })
    const fallen = makeActor('P3', { hp: 0, maxHp: 25 })
    fallen.alive = false
    fallen.stats.hp = 0

    const state = createState({
      rngSeed: 42,
      actors: {
        [leader.id]: leader,
        [ally.id]: ally,
        [fallen.id]: fallen,
      },
      sidePlayer: [leader.id, ally.id, fallen.id],
      sideEnemy: [],
      inventory: [],
    })

    applyStatus(state, leader.id, 'aura', 2, { sourceId: leader.id })

    tickEndOfTurn(state, leader.id)

    expect(leader.stats.hp).toBe(15)
    expect(ally.stats.hp).toBe(11)
    expect(fallen.alive).toBe(true)
    expect(fallen.stats.hp).toBe(5)
  })

  it('skips hook targets that fail onlyIf conditions', () => {
    registryMap.recovery = statusTemplate({
      id: 'recovery',
      durationTurns: 2,
      hooks: {
        onApply: [],
        onTurnStart: [],
        onTurnEnd: [
          {
            kind: 'heal',
            value: {
              kind: 'flat',
              resolve: () => 50,
              rawAmount: 50,
            },
            selector: {
              side: 'ally',
              mode: 'all',
              includeDead: false,
              count: 0,
            },
            onlyIf: {
              test: { key: 'hpPct', op: 'lt', value: 1 },
            },
            canCrit: false,
            canMiss: false,
          } as RuntimeEffect,
        ],
        onDealDamage: [],
        onTakeDamage: [],
        onExpire: [],
      },
    })

    const owner = makeActor('P10', { hp: 10, maxHp: 40 })
    const injured = makeActor('P11', { hp: 5, maxHp: 30 })
    const healthy = makeActor('P12', { hp: 50, maxHp: 50 })

    const state = createState({
      rngSeed: 99,
      actors: {
        [owner.id]: owner,
        [injured.id]: injured,
        [healthy.id]: healthy,
      },
      sidePlayer: [owner.id, injured.id, healthy.id],
      sideEnemy: [],
      inventory: [],
    })

    applyStatus(state, owner.id, 'recovery', 2, { sourceId: owner.id })

    tickEndOfTurn(state, owner.id)

    expect(owner.stats.hp).toBe(40)
    expect(injured.stats.hp).toBe(30)
    expect(healthy.stats.hp).toBe(50)

    tickEndOfTurn(state, owner.id)

    expect(owner.stats.hp).toBe(40)
    expect(injured.stats.hp).toBe(30)
    expect(healthy.stats.hp).toBe(50)
  })
})

