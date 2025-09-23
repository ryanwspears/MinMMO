import { describe, expect, it } from 'vitest'

import { resolveTargets } from '@engine/battle/targeting'
import type { Actor, BattleState } from '@engine/battle/types'
import type { TargetSelector } from '@config/schema'

const HERO_ID = 'hero'

describe('resolveTargets - advanced modes', () => {
  it('selects the highest metric targets when using highest mode', () => {
    const state = createState()
    state.actors.slime.stats.atk = 12
    state.actors.goblin.stats.atk = 30

    const selector: TargetSelector = { side: 'enemy', mode: 'highest', ofWhat: 'atk', count: 2 }
    expect(resolveTargets(state, selector, HERO_ID)).toEqual(['goblin', 'slime'])
  })

  it('applies nested filter trees with includeDead to return condition targets', () => {
    const state = createState()
    state.actors.goblin.alive = false
    state.actors.goblin.stats.hp = 0
    state.actors.goblin.statuses.push({ id: 'Burn', turns: 2 })
    state.actors.slime.statuses.push({ id: 'Freeze', turns: 1 })

    const selector: TargetSelector = {
      side: 'any',
      mode: 'condition',
      includeDead: true,
      count: 1,
      condition: {
        all: [
          {
            any: [
              { test: { key: 'hasStatus', op: 'eq', value: 'Burn' } },
              { test: { key: 'hasStatus', op: 'eq', value: 'Poison' } },
            ],
          },
          { not: { test: { key: 'tag', op: 'eq', value: 'player' } } },
        ],
      },
    }

    expect(resolveTargets(state, selector, HERO_ID)).toEqual(['goblin'])
  })

  it('limits the number of condition targets and honours any filters', () => {
    const state = createState()
    state.actors.mage.clazz = 'mage'
    state.actors.slime.tags.push('boss')

    const selector: TargetSelector = {
      side: 'any',
      mode: 'condition',
      count: 2,
      condition: {
        any: [
          { test: { key: 'tag', op: 'eq', value: 'boss' } },
          { test: { key: 'clazz', op: 'eq', value: 'mage' } },
        ],
      },
    }

    expect(resolveTargets(state, selector, HERO_ID)).toEqual(['mage', 'slime'])
  })
})

function createState(): BattleState {
  const hero = makeActor(HERO_ID, { tags: ['player'], clazz: 'warrior' })
  const mage = makeActor('mage', { tags: ['player'], clazz: 'sorcerer' })
  const slime = makeActor('slime', { tags: ['enemy'] })
  const goblin = makeActor('goblin', { tags: ['enemy'] })

  return {
    turn: 1,
    order: [hero.id, mage.id, slime.id, goblin.id],
    current: 0,
    rngSeed: 123,
    actors: {
      [hero.id]: hero,
      [mage.id]: mage,
      [slime.id]: slime,
      [goblin.id]: goblin,
    },
    sidePlayer: [hero.id, mage.id],
    sideEnemy: [slime.id, goblin.id],
    inventory: [],
    log: [],
    cooldowns: {},
    charges: {},
    shields: {},
    taunts: {},
  }
}

function makeActor(id: string, overrides: Partial<Actor> = {}): Actor {
  const baseStats = {
    maxHp: 100,
    hp: 100,
    maxSta: 50,
    sta: 50,
    maxMp: 30,
    mp: 30,
    atk: 10,
    def: 5,
    lv: 1,
    xp: 0,
    gold: 0,
  }

  return {
    id,
    name: overrides.name ?? id,
    color: overrides.color,
    clazz: overrides.clazz,
    stats: { ...baseStats, ...(overrides.stats ?? {}) },
    statuses: overrides.statuses ? overrides.statuses.map((entry) => ({ ...entry })) : [],
    alive: overrides.alive ?? true,
    tags: overrides.tags ? [...overrides.tags] : [],
    meta: overrides.meta,
  }
}
