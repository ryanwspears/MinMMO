import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeEffect, RuntimeItem, RuntimeSkill, RuntimeTargetSelector } from '@content/adapters'
import { applyStatus } from '@engine/battle/status'
import {
  useItem,
  useSkill,
  endTurn,
  resolveActionTargetIds,
  collectUsableTargets,
  attemptFlee,
} from '@engine/battle/actions'
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
      maxHp: 100,
      hp: 100,
      maxSta: 20,
      sta: 20,
      maxMp: 15,
      mp: 15,
      atk: 10,
      def: 5,
      lv: 1,
      xp: 0,
      gold: 0,
      ...overrides,
    },
    statuses: [],
    alive: true,
    tags: id.startsWith('P') ? ['player'] : ['enemy'],
  }
}

function makeSelector(selector: Partial<RuntimeTargetSelector>): RuntimeTargetSelector {
  return {
    side: 'enemy',
    mode: 'single',
    includeDead: false,
    ...selector,
  }
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
    sharedAccuracyRoll: true,
  }
}

function makeSkill(partial: Partial<RuntimeSkill>): RuntimeSkill {
  return {
    id: 'test-skill',
    type: 'skill',
    name: 'Test Skill',
    targeting: makeSelector({ side: 'enemy' }),
    effects: [],
    costs: { sta: 0, mp: 0, cooldown: 0 },
    aiWeight: 1,
    ...partial,
  }
}

function makeItem(partial: Partial<RuntimeItem>): RuntimeItem {
  return {
    id: 'test-item',
    type: 'item',
    name: 'Test Item',
    targeting: makeSelector({ side: 'enemy' }),
    effects: [],
    costs: { sta: 0, mp: 0, cooldown: 0 },
    consumable: true,
    aiWeight: 1,
    ...partial,
  }
}

function makeState(players: Actor[], enemies: Actor[], inventory: { id: string; qty: number }[] = []): BattleState {
  const actors: Record<string, Actor> = {}
  const sidePlayer: string[] = []
  const sideEnemy: string[] = []
  for (const actor of players) {
    actors[actor.id] = actor
    sidePlayer.push(actor.id)
  }
  for (const actor of enemies) {
    actors[actor.id] = actor
    sideEnemy.push(actor.id)
  }
  return createState({
    rngSeed: 123,
    actors,
    sidePlayer,
    sideEnemy,
    inventory,
  })
}

let configSpy: ReturnType<typeof vi.spyOn> | undefined
let statusesSpy: ReturnType<typeof vi.spyOn> | undefined

beforeEach(() => {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS))
  cfg.balance.BASE_HIT = 1
  cfg.balance.BASE_CRIT = 0
  cfg.balance.DODGE_FLOOR = 0
  cfg.balance.HIT_CEIL = 1
  cfg.balance.ELEMENT_MATRIX = { neutral: { neutral: 1 } }
  cfg.balance.RESISTS_BY_TAG = {}
  configSpy = vi.spyOn(configStore, 'CONFIG').mockReturnValue(cfg)
  statusesSpy = vi.spyOn(registry, 'Statuses').mockReturnValue({})
})

afterEach(() => {
  configSpy?.mockRestore()
  statusesSpy?.mockRestore()
  vi.restoreAllMocks()
})

describe('battle actions advanced behaviour', () => {
  it('revives a fallen ally with revive effects', () => {
    const player = makeActor('P1')
    const ally = makeActor('P2', { hp: 0 })
    ally.alive = false
    const enemy = makeActor('E1')
    const state = makeState([player, ally], [enemy])

    const revive = makeSkill({
      name: 'Revive',
      targeting: makeSelector({ side: 'ally', mode: 'single', includeDead: true }),
      effects: [flatEffect('revive', 40)],
    })

    const result = useSkill(state, revive, player.id, [ally.id])
    expect(result.ok).toBe(true)
    expect(state.actors[ally.id]?.alive).toBe(true)
    expect(state.actors[ally.id]?.stats.hp).toBe(40)
    expect(state.log.some((entry) => entry.includes('revived'))).toBe(true)
  })

  it('applies shields that absorb subsequent damage', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])

    const barrier = makeSkill({
      id: 'barrier',
      name: 'Barrier',
      targeting: makeSelector({ side: 'ally', mode: 'single' }),
      effects: [{ ...flatEffect('shield', 30), shieldId: 'Barrier', selector: makeSelector({ side: 'ally' }) }],
    })

    const blast = makeSkill({
      id: 'blast',
      name: 'Blast',
      effects: [flatEffect('damage', 20)],
    })

    const shieldResult = useSkill(state, barrier, player.id, [player.id])
    expect(shieldResult.ok).toBe(true)
    expect(state.shields[player.id]?.Barrier?.hp).toBe(30)

    const damageResult = useSkill(state, blast, enemy.id, [player.id])
    expect(damageResult.ok).toBe(true)
    expect(state.actors[player.id]?.stats.hp).toBe(100)
    expect(state.shields[player.id]?.Barrier?.hp).toBe(10)
    expect(state.log.some((entry) => entry.includes('absorbed'))).toBe(true)
  })

  it('cleanses statuses with matching tags', () => {
    statusesSpy?.mockReturnValue({
      Burn: {
        id: 'Burn',
        name: 'Burn',
        stackRule: 'renew',
        maxStacks: 1,
        durationTurns: 3,
        tags: ['fire'],
        modifiers: {},
        hooks: { onApply: [], onTurnStart: [], onTurnEnd: [], onDealDamage: [], onTakeDamage: [], onExpire: [] },
      },
      Poison: {
        id: 'Poison',
        name: 'Poison',
        stackRule: 'renew',
        maxStacks: 1,
        durationTurns: 3,
        tags: ['toxin'],
        modifiers: {},
        hooks: { onApply: [], onTurnStart: [], onTurnEnd: [], onDealDamage: [], onTakeDamage: [], onExpire: [] },
      },
    })

    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])

    applyStatus(state, player.id, 'Burn', 3)
    applyStatus(state, player.id, 'Poison', 3)
    expect(state.actors[player.id]?.statuses).toHaveLength(2)

    const cleanse = makeSkill({
      name: 'Cleanse',
      targeting: makeSelector({ side: 'ally', mode: 'single' }),
      effects: [{ ...flatEffect('cleanseStatus', 0), cleanseTags: ['fire'] }],
    })

    const result = useSkill(state, cleanse, player.id, [player.id])
    expect(result.ok).toBe(true)
    expect(state.actors[player.id]?.statuses).toHaveLength(1)
    expect(state.log.some((entry) => entry.includes('cleansed'))).toBe(true)
  })

  it('blocks a skill with canUse until the condition is satisfied', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])

    const desperation = makeSkill({
      name: 'Desperation',
      costs: { sta: 5, mp: 0, cooldown: 0 },
      canUse: { test: { key: 'hpPct', op: 'lt', value: 1 } },
      effects: [flatEffect('damage', 10)],
    })

    const firstAttempt = useSkill(state, desperation, player.id, [enemy.id])
    expect(firstAttempt.ok).toBe(false)
    expect(state.actors[player.id]?.stats.sta).toBe(20)
    expect(state.log[state.log.length - 1]).toContain('cannot use Desperation')

    enemy.stats.hp = 50

    const secondAttempt = useSkill(state, desperation, player.id, [enemy.id])
    expect(secondAttempt.ok).toBe(true)
    expect(state.actors[player.id]?.stats.sta).toBe(15)
    expect(state.log.some((entry) => entry.includes('used Desperation'))).toBe(true)
  })

  it('re-rolls random targets to satisfy canUse filters', () => {
    const skill = makeSkill({
      name: 'Hex Bolt',
      targeting: makeSelector({ side: 'enemy', mode: 'random', count: 1 }),
      canUse: { test: { key: 'tag', op: 'in', value: ['cursed'] } },
      effects: [flatEffect('damage', 5)],
    })

    const seeds = [1, 42, 1337, 9001]
    for (const seed of seeds) {
      const player = makeActor('P1')
      const cursed = makeActor('E2')
      cursed.tags = ['enemy', 'cursed']
      const enemies = [makeActor('E1'), cursed, makeActor('E3')]
      const state = makeState([player], enemies)
      state.rngSeed = seed

      const result = useSkill(state, skill, player.id)
      expect(result.ok).toBe(true)
      expect(state.actors['E2']?.stats.hp).toBe(95)
      expect(state.actors['E1']?.stats.hp).toBe(100)
      expect(state.actors['E3']?.stats.hp).toBe(100)
    }

    const player = makeActor('P1')
    const state = makeState([player], [makeActor('E1'), makeActor('E2'), makeActor('E3')])
    const fail = useSkill(state, skill, player.id)
    expect(fail.ok).toBe(false)
    expect(state.log[state.log.length - 1]).toContain('cannot use Hex Bolt')
  })

  it('filters random targets by canUse for players and AI alike', () => {
    const skill = makeSkill({
      name: 'Scorching Shot',
      targeting: makeSelector({ side: 'enemy', mode: 'random' }),
      canUse: { test: { key: 'tag', op: 'in', value: ['burning'] } },
      effects: [flatEffect('damage', 10)],
    })

    const player = makeActor('P1')
    const burningEnemy = makeActor('E-hot')
    burningEnemy.tags.push('burning')
    const otherEnemy = makeActor('E-cold')
    const playerState = makeState([player], [burningEnemy, otherEnemy])

    const result = useSkill(playerState, skill, player.id)
    expect(result.ok).toBe(true)
    expect(playerState.actors[burningEnemy.id]?.stats.hp).toBeLessThan(100)
    expect(playerState.actors[otherEnemy.id]?.stats.hp).toBe(100)

    const enemyUser = makeActor('E-boss')
    const burningPlayer = makeActor('P-hot')
    burningPlayer.tags.push('burning')
    const otherPlayer = makeActor('P-cold')
    const aiState = makeState([burningPlayer, otherPlayer], [enemyUser])

    const prevSeed = aiState.rngSeed
    const resolution = resolveActionTargetIds(aiState, skill, enemyUser)
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.targetIds).toEqual([burningPlayer.id])
    }
    aiState.rngSeed = prevSeed

    const aiResult = useSkill(aiState, skill, enemyUser.id)
    expect(aiResult.ok).toBe(true)
    expect(aiState.actors[burningPlayer.id]?.stats.hp).toBeLessThan(100)
    expect(aiState.actors[otherPlayer.id]?.stats.hp).toBe(100)
  })

  it('ends the battle when fleeing succeeds', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])
    const cfg = configStore.CONFIG()
    cfg.balance.FLEE_BASE = 1

    const result = attemptFlee(state, player.id)

    expect(result.ok).toBe(true)
    expect(state.ended).toEqual({ reason: 'fled' })
    expect(state.log[state.log.length - 1]).toContain('fled the battle')
  })

  it('logs a failure when fleeing fails', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])
    const cfg = configStore.CONFIG()
    cfg.balance.FLEE_BASE = 0

    const result = attemptFlee(state, player.id)

    expect(result.ok).toBe(false)
    expect(state.ended).toBeUndefined()
    expect(state.log[state.log.length - 1]).toContain('tried to flee but failed')
  })

  it('resolves canUse-gated random targets deterministically for players and enemies', () => {
    const randomSkill = makeSkill({
      id: 'precise-shot',
      name: 'Precise Shot',
      targeting: makeSelector({ side: 'enemy', mode: 'random', count: 1 }),
      canUse: { test: { key: 'hpPct', op: 'lte', value: 0.5 } },
      effects: [{ ...flatEffect('resource', -3), resource: 'mp' }],
    })

    const makeEnemies = () => [makeActor('E-healthy'), makeActor('E-wounded', { hp: 40 })]

    const playerCollectionState = makeState([makeActor('P1')], makeEnemies())
    const playerActor = playerCollectionState.actors['P1']!
    const playerCollection = collectUsableTargets(playerCollectionState, randomSkill, playerActor)
    expect(playerCollection.ok).toBe(true)
    if (playerCollection.ok) {
      expect(playerCollection.targets.map((actor) => actor.id)).toEqual(['E-wounded'])
    }

    const playerUseStateA = makeState([makeActor('P1')], makeEnemies())
    const playerUseStateB = makeState([makeActor('P1')], makeEnemies())
    const playerResultA = useSkill(playerUseStateA, randomSkill, 'P1')
    const playerResultB = useSkill(playerUseStateB, randomSkill, 'P1')
    expect(playerResultA.ok).toBe(true)
    expect(playerResultB.ok).toBe(true)
    expect(playerUseStateA.actors['E-wounded']?.stats.mp).toBe(12)
    expect(playerUseStateB.actors['E-wounded']?.stats.mp).toBe(12)
    expect(playerUseStateA.actors['E-healthy']?.stats.mp).toBe(15)
    expect(playerUseStateB.actors['E-healthy']?.stats.mp).toBe(15)
    expect(playerUseStateA.rngSeed).toBe(playerUseStateB.rngSeed)

    const makePlayers = () => [makeActor('P-front'), makeActor('P-weak', { hp: 30 })]
    const makeEnemy = () => makeActor('E-boss')

    const enemyCollectionState = makeState(makePlayers(), [makeEnemy()])
    const enemyActor = enemyCollectionState.actors['E-boss']!
    const enemyCollection = collectUsableTargets(enemyCollectionState, randomSkill, enemyActor)
    expect(enemyCollection.ok).toBe(true)
    if (enemyCollection.ok) {
      expect(enemyCollection.targets.map((actor) => actor.id)).toEqual(['P-weak'])
    }

    const enemyUseStateA = makeState(makePlayers(), [makeEnemy()])
    const enemyUseStateB = makeState(makePlayers(), [makeEnemy()])
    const enemyResultA = useSkill(enemyUseStateA, randomSkill, 'E-boss')
    const enemyResultB = useSkill(enemyUseStateB, randomSkill, 'E-boss')
    expect(enemyResultA.ok).toBe(true)
    expect(enemyResultB.ok).toBe(true)
    expect(enemyUseStateA.actors['P-weak']?.stats.mp).toBe(12)
    expect(enemyUseStateB.actors['P-weak']?.stats.mp).toBe(12)
    expect(enemyUseStateA.actors['P-front']?.stats.mp).toBe(15)
    expect(enemyUseStateB.actors['P-front']?.stats.mp).toBe(15)
    expect(enemyUseStateA.rngSeed).toBe(enemyUseStateB.rngSeed)
  })

  it('enforces charges on limited-use skills', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])

    const limited = makeSkill({
      id: 'limited',
      name: 'Limited',
      costs: { sta: 0, mp: 0, cooldown: 0, charges: 2 },
      effects: [flatEffect('damage', 5)],
    })

    expect(useSkill(state, limited, player.id, [enemy.id]).ok).toBe(true)
    expect(useSkill(state, limited, player.id, [enemy.id]).ok).toBe(true)
    const third = useSkill(state, limited, player.id, [enemy.id])
    expect(third.ok).toBe(false)
    expect(state.charges[player.id]?.limited?.remaining).toBe(0)
    expect(state.log[state.log.length - 1]).toContain('no charges')
  })

  it('respects cooldowns across turns', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])

    const cooled = makeSkill({
      id: 'cooldown',
      name: 'Cooldown',
      costs: { sta: 0, mp: 0, cooldown: 2 },
      effects: [flatEffect('damage', 5)],
    })

    expect(useSkill(state, cooled, player.id, [enemy.id]).ok).toBe(true)
    expect(useSkill(state, cooled, player.id, [enemy.id]).ok).toBe(false)
    endTurn(state)
    endTurn(state)
    expect(useSkill(state, cooled, player.id, [enemy.id]).ok).toBe(true)
  })

  it('consumes items from inventory when used', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy], [{ id: 'Potion', qty: 2 }])

    const potion = makeItem({
      id: 'Potion',
      name: 'Potion',
      targeting: makeSelector({ side: 'ally', mode: 'single' }),
      effects: [flatEffect('heal', 20)],
    })

    expect(useItem(state, potion, player.id, [player.id]).ok).toBe(true)
    expect(state.inventory.find((entry) => entry.id === 'Potion')?.qty).toBe(1)
    expect(useItem(state, potion, player.id, [player.id]).ok).toBe(true)
    expect(state.inventory.find((entry) => entry.id === 'Potion')).toBeUndefined()
  })

  it('runs onDealDamage hooks from statuses', () => {
    statusesSpy?.mockReturnValue({
      Fury: {
        id: 'Fury',
        name: 'Fury',
        stackRule: 'renew',
        maxStacks: 1,
        durationTurns: 3,
        tags: [],
        modifiers: {},
        hooks: {
          onApply: [],
          onTurnStart: [],
          onTurnEnd: [],
          onDealDamage: [flatEffect('heal', 10)],
          onTakeDamage: [],
          onExpire: [],
        },
      },
    })

    const player = makeActor('P1', { hp: 50 })
    const enemy = makeActor('E1', { hp: 50 })
    const state = makeState([player], [enemy])

    applyStatus(state, player.id, 'Fury', 3, { sourceId: player.id })

    const strike = makeSkill({
      name: 'Strike',
      effects: [flatEffect('damage', 15)],
    })

    useSkill(state, strike, player.id, [enemy.id])
    expect(state.actors[player.id]?.stats.hp).toBe(60)
    expect(state.log.some((entry) => entry.includes('recovers'))).toBe(true)
  })

  it('runs onTakeDamage hooks from statuses', () => {
    statusesSpy?.mockReturnValue({
      Thorns: {
        id: 'Thorns',
        name: 'Thorns',
        stackRule: 'renew',
        maxStacks: 1,
        durationTurns: 3,
        tags: [],
        modifiers: {},
        hooks: {
          onApply: [],
          onTurnStart: [],
          onTurnEnd: [],
          onDealDamage: [],
          onTakeDamage: [flatEffect('damage', 5)],
          onExpire: [],
        },
      },
    })

    const player = makeActor('P1')
    const enemy = makeActor('E1', { hp: 50 })
    const state = makeState([player], [enemy])

    applyStatus(state, player.id, 'Thorns', 3, { sourceId: player.id })

    const bite = makeSkill({
      name: 'Bite',
      effects: [flatEffect('damage', 10)],
    })

    useSkill(state, bite, enemy.id, [player.id])
    expect(state.actors[enemy.id]?.stats.hp).toBe(45)
    expect(state.log.some((entry) => entry.includes('suffers'))).toBe(true)
  })

  it('stores taunt targets and durations', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])

    const provoke = makeSkill({
      name: 'Provoke',
      targeting: makeSelector({ side: 'enemy', mode: 'single' }),
      effects: [{ ...flatEffect('taunt', 2), statusTurns: 2 }],
    })

    useSkill(state, provoke, player.id, [enemy.id])
    expect(state.taunts[enemy.id]?.sourceId).toBe(player.id)
    expect(state.taunts[enemy.id]?.turns).toBe(2)
  })

  it('allows fleeing to end the battle', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState([player], [enemy])
    const cfg = configStore.CONFIG()
    cfg.balance.FLEE_BASE = 1

    const flee = makeSkill({
      name: 'Escape',
      targeting: makeSelector({ side: 'self', mode: 'self' }),
      effects: [flatEffect('flee', 0)],
    })

    const result = useSkill(state, flee, player.id)
    expect(result.ok).toBe(true)
    expect(state.ended?.reason).toBe('fled')
  })
})
