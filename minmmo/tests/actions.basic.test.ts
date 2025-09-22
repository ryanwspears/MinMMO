import { describe, expect, it } from 'vitest'

import type { RuntimeEffect, RuntimeItem, RuntimeSkill, RuntimeTargetSelector } from '@content/adapters'
import { useItem, useSkill, endTurn } from '@engine/battle/actions'
import { createState } from '@engine/battle/state'
import type { Actor, BattleState } from '@engine/battle/types'

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
  }
}

function percentEffect(kind: RuntimeEffect['kind'], fraction: number): RuntimeEffect {
  return {
    kind,
    value: {
      kind: 'percent',
      resolve: () => fraction,
      rawPercent: fraction * 100,
    },
    canCrit: false,
    canMiss: false,
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

function makeState(player: Actor, enemy: Actor): BattleState {
  return createState({
    rngSeed: 123,
    actors: { [player.id]: player, [enemy.id]: enemy },
    sidePlayer: [player.id],
    sideEnemy: [enemy.id],
    inventory: [],
  })
}

describe('battle actions basics', () => {
  it('uses a damaging item to defeat an enemy', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1', { hp: 20, maxHp: 20 })
    const state = makeState(player, enemy)

    const bomb = makeItem({
      name: 'Bomb',
      effects: [flatEffect('damage', 50)],
      targeting: makeSelector({ side: 'enemy' }),
    })

    const result = useItem(state, bomb, player.id, [enemy.id])
    expect(result.ok).toBe(true)
    expect(state.actors[enemy.id]?.stats.hp).toBe(0)
    expect(state.actors[enemy.id]?.alive).toBe(false)
    expect(state.ended?.reason).toBe('victory')
    expect(state.log[state.log.length - 1]).toContain('Victory')
  })

  it('heals allies by percent of max HP without exceeding cap', () => {
    const player = makeActor('P1', { hp: 50, maxHp: 100 })
    const enemy = makeActor('E1')
    const state = makeState(player, enemy)

    const mend = makeSkill({
      name: 'Mend',
      targeting: makeSelector({ side: 'ally', mode: 'single' }),
      effects: [percentEffect('heal', 0.25)],
    })

    const result = useSkill(state, mend, player.id, [player.id])
    expect(result.ok).toBe(true)
    expect(state.actors[player.id]?.stats.hp).toBe(75)
    expect(state.log.find((line) => line.includes('healed'))).toBeTruthy()
  })

  it('restores stamina with resource effects', () => {
    const player = makeActor('P1', { sta: 2, maxSta: 10 })
    const enemy = makeActor('E1')
    const state = makeState(player, enemy)

    const secondWind = makeSkill({
      name: 'Second Wind',
      targeting: makeSelector({ side: 'self', mode: 'self' }),
      effects: [percentEffect('resource', 0.5)],
    })
    // attach resource info to effect
    secondWind.effects[0].resource = 'sta'

    const result = useSkill(state, secondWind, player.id, [player.id])
    expect(result.ok).toBe(true)
    expect(state.actors[player.id]?.stats.sta).toBe(7)
  })

  it('blocks actions when MP is insufficient', () => {
    const player = makeActor('P1', { mp: 2 })
    const enemy = makeActor('E1')
    const state = makeState(player, enemy)

    const expensive = makeSkill({
      name: 'Arcane Burst',
      costs: { sta: 0, mp: 5, cooldown: 0 },
      effects: [flatEffect('damage', 10)],
    })

    const result = useSkill(state, expensive, player.id, [enemy.id])
    expect(result.ok).toBe(false)
    expect(state.actors[player.id]?.stats.mp).toBe(2)
    expect(state.log[state.log.length - 1]).toContain('Not enough MP')
  })

  it('advances the turn order when ending a turn', () => {
    const player = makeActor('P1')
    const enemy = makeActor('E1')
    const state = makeState(player, enemy)

    expect(state.current).toBe(0)
    expect(state.turn).toBe(1)

    endTurn(state)
    expect(state.current).toBe(1)
    expect(state.turn).toBe(1)

    endTurn(state)
    expect(state.current).toBe(0)
    expect(state.turn).toBe(2)
    expect(state.log.filter((line) => line.includes('Turn')).length).toBeGreaterThan(0)
  })
})
