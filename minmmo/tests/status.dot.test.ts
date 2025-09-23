import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeEffect, RuntimeSkill, RuntimeStatusTemplate } from '@content/adapters'
import { useSkill, endTurn } from '@engine/battle/actions'
import { applyStatus, tickEndOfTurn, tickStartOfTurn } from '@engine/battle/status'
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

function makeDuelState(player: Actor, enemy: Actor): BattleState {
  const actors: Record<string, Actor> = {
    [player.id]: player,
    [enemy.id]: enemy,
  }
  return createState({
    rngSeed: 123,
    actors,
    sidePlayer: [player.id],
    sideEnemy: [enemy.id],
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

  it('prevents actions when onTurnStart calls preventAction', () => {
    registryMap.paralyze = statusTemplate({
      id: 'paralyze',
      name: 'Paralyze',
      durationTurns: 1,
      hooks: {
        onApply: [],
        onTurnStart: [
          {
            kind: 'damage',
            value: {
              kind: 'flat',
              resolve: (_user, target, ctx) => {
                ctx.control?.preventAction(`${target.name} is paralyzed!`)
                return 0
              },
              rawAmount: 0,
            },
            canCrit: false,
            canMiss: false,
          } as RuntimeEffect,
        ],
        onTurnEnd: [],
        onDealDamage: [],
        onTakeDamage: [],
        onExpire: [],
      },
    })

    const player = makeActor('Hero', { hp: 30, maxHp: 30 })
    const enemy = makeActor('Goblin', { hp: 20, maxHp: 20 })
    enemy.tags = ['enemy']
    const state = makeDuelState(player, enemy)

    applyStatus(state, player.id, 'paralyze', 1)
    const prevented = tickStartOfTurn(state, player.id)
    expect(prevented).toBe(true)
    expect(state.log[state.log.length - 1]).toBe(`${player.name} is paralyzed!`)

    endTurn(state)
    expect(state.order[state.current]).toBe(enemy.id)
    expect(state.log.some((entry) => entry.includes(`${player.name} ended their turn.`))).toBe(true)
    expect(state.log.some((entry) => entry.includes('Paralyze') && entry.includes('expired'))).toBe(true)
  })

  describe('status modifiers', () => {
    function strikeSkill(): RuntimeSkill {
      return {
        id: 'strike',
        name: 'Strike',
        type: 'skill',
        targeting: { side: 'enemy', mode: 'single' },
        effects: [
          {
            kind: 'damage',
            value: {
              kind: 'flat',
              resolve: (user: Actor, target: Actor) => Math.max(0, user.stats.atk - target.stats.def),
            },
            canCrit: false,
            canMiss: false,
          } as RuntimeEffect,
        ],
      } as RuntimeSkill
    }

    it('attack buff increases damage dealt', () => {
      registryMap.attackUp = statusTemplate({
        id: 'attackUp',
        durationTurns: 2,
        modifiers: { atk: 5 },
      })

      const baseHero = makeActor('HeroA', { atk: 10 })
      const baseEnemy = makeActor('EnemyA', { def: 4, hp: 50, maxHp: 50 })
      baseEnemy.tags = ['enemy']
      const baseState = makeDuelState(baseHero, baseEnemy)
      const skill = strikeSkill()
      useSkill(baseState, skill, baseHero.id, [baseEnemy.id])
      const baseDamage = 50 - baseEnemy.stats.hp

      const buffHero = makeActor('HeroB', { atk: 10 })
      const buffEnemy = makeActor('EnemyB', { def: 4, hp: 50, maxHp: 50 })
      buffEnemy.tags = ['enemy']
      const buffState = makeDuelState(buffHero, buffEnemy)
      applyStatus(buffState, buffHero.id, 'attackUp', 2)
      expect(buffHero.stats.atk).toBe(15)
      useSkill(buffState, skill, buffHero.id, [buffEnemy.id])
      const buffDamage = 50 - buffEnemy.stats.hp

      expect(buffDamage).toBeGreaterThan(baseDamage)
    })

    it('defense buff reduces incoming damage', () => {
      registryMap.ironSkin = statusTemplate({
        id: 'ironSkin',
        durationTurns: 2,
        modifiers: { def: 6 },
      })

      const baseHero = makeActor('HeroC', { atk: 14 })
      const baseEnemy = makeActor('EnemyC', { def: 4, hp: 50, maxHp: 50 })
      baseEnemy.tags = ['enemy']
      const baseState = makeDuelState(baseHero, baseEnemy)
      const skill = strikeSkill()
      useSkill(baseState, skill, baseHero.id, [baseEnemy.id])
      const baseDamage = 50 - baseEnemy.stats.hp

      const buffHero = makeActor('HeroD', { atk: 14 })
      const buffEnemy = makeActor('EnemyD', { def: 4, hp: 50, maxHp: 50 })
      buffEnemy.tags = ['enemy']
      const buffState = makeDuelState(buffHero, buffEnemy)
      applyStatus(buffState, buffEnemy.id, 'ironSkin', 2)
      expect(buffEnemy.stats.def).toBe(10)
      useSkill(buffState, skill, buffHero.id, [buffEnemy.id])
      const buffDamage = 50 - buffEnemy.stats.hp

      expect(buffDamage).toBeLessThan(baseDamage)
    })

    it('damage taken debuff increases incoming damage', () => {
      registryMap.vulnerable = statusTemplate({
        id: 'vulnerable',
        durationTurns: 2,
        modifiers: { damageTakenPct: { all: 0.5 } },
      })

      const baseHero = makeActor('HeroE', { atk: 12 })
      const baseEnemy = makeActor('EnemyE', { def: 3, hp: 50, maxHp: 50 })
      baseEnemy.tags = ['enemy']
      const baseState = makeDuelState(baseHero, baseEnemy)
      const skill = strikeSkill()
      useSkill(baseState, skill, baseHero.id, [baseEnemy.id])
      const baseDamage = 50 - baseEnemy.stats.hp

      const debuffedHero = makeActor('HeroF', { atk: 12 })
      const debuffedEnemy = makeActor('EnemyF', { def: 3, hp: 50, maxHp: 50 })
      debuffedEnemy.tags = ['enemy']
      const debuffState = makeDuelState(debuffedHero, debuffedEnemy)
      applyStatus(debuffState, debuffedEnemy.id, 'vulnerable', 2)
      useSkill(debuffState, skill, debuffedHero.id, [debuffedEnemy.id])
      const debuffedDamage = 50 - debuffedEnemy.stats.hp

      expect(debuffedDamage).toBeGreaterThan(baseDamage)
    })
  })
})

