import { describe, expect, it } from 'vitest'

import { resolveTargets } from '@engine/battle/targeting'
import type { Actor, BattleState } from '@engine/battle/types'
import type { TargetSelector } from '@config/schema'

describe('resolveTargets', () => {
  it('selects the first enemy for single targeting', () => {
    const state = createState()
    const selector: TargetSelector = { side: 'enemy', mode: 'single' }
    expect(resolveTargets(state, selector, 'hero')).toEqual(['slime'])
  })

  it('forces taunted actors to target the source enemy', () => {
    const state = createState()
    state.taunts.hero = { sourceId: 'goblin', turns: 1 }

    const selector: TargetSelector = { side: 'enemy', mode: 'single' }
    expect(resolveTargets(state, selector, 'hero')).toEqual(['goblin'])
    expect(state.taunts.hero).toBeDefined()
  })

  it('clears taunts when the source is no longer valid', () => {
    const state = createState()
    state.taunts.hero = { sourceId: 'goblin', turns: 1 }
    state.actors.goblin.alive = false

    const selector: TargetSelector = { side: 'enemy', mode: 'single' }
    expect(resolveTargets(state, selector, 'hero')).toEqual(['slime'])
    expect(state.taunts.hero).toBeUndefined()
  })

  it('returns all allies for all mode', () => {
    const state = createState()
    const selector: TargetSelector = { side: 'ally', mode: 'all' }
    expect(resolveTargets(state, selector, 'hero')).toEqual(['hero', 'mage'])
  })

  it('respects includeDead flag', () => {
    const state = createState()
    state.actors.mage.alive = false
    state.actors.mage.stats.hp = 0

    const withoutDead: TargetSelector = { side: 'ally', mode: 'all' }
    expect(resolveTargets(state, withoutDead, 'hero')).toEqual(['hero'])

    const withDead: TargetSelector = { side: 'ally', mode: 'all', includeDead: true }
    expect(resolveTargets(state, withDead, 'hero')).toEqual(['hero', 'mage'])
  })

  it('returns the user for self targeting', () => {
    const state = createState()
    const selector: TargetSelector = { side: 'self', mode: 'self' }
    expect(resolveTargets(state, selector, 'hero')).toEqual(['hero'])
  })

  it('combines sides when targeting any', () => {
    const state = createState()
    const selector: TargetSelector = { side: 'any', mode: 'all' }
    expect(resolveTargets(state, selector, 'hero')).toEqual([
      'hero',
      'mage',
      'slime',
      'goblin',
    ])
  })

  it('picks unique random targets and advances rngSeed', () => {
    const state = createState()
    const ogre = makeActor('ogre', { tags: ['enemy'] })
    state.actors.ogre = ogre
    state.sideEnemy.push('ogre')
    state.order.push('ogre')
    state.rngSeed = 7

    const selector: TargetSelector = { side: 'enemy', mode: 'random', count: 2 }
    const result = resolveTargets(state, selector, 'hero')

    expect(result.length).toBe(2)
    expect(new Set(result).size).toBe(2)
    expect(state.rngSeed).not.toBe(7)
    expect(result.every((id) => ['slime', 'goblin', 'ogre'].includes(id))).toBe(true)
  })

  it('filters candidates using condition mode', () => {
    const state = createState()
    state.actors.slime.tags.push('boss')

    const selector: TargetSelector = {
      side: 'enemy',
      mode: 'condition',
      condition: { test: { key: 'tag', op: 'eq', value: 'boss' } },
    }

    expect(resolveTargets(state, selector, 'hero')).toEqual(['slime'])
  })

  it('orders by metric when using lowest mode', () => {
    const state = createState()
    state.actors.slime.stats.hp = 10
    state.actors.slime.stats.maxHp = 100
    state.actors.goblin.stats.hp = 40
    state.actors.goblin.stats.maxHp = 80

    const selector: TargetSelector = { side: 'enemy', mode: 'lowest', ofWhat: 'hpPct', count: 2 }
    expect(resolveTargets(state, selector, 'hero')).toEqual(['slime', 'goblin'])
  })
})

function createState(): BattleState {
  const hero = makeActor('hero', { tags: ['player'] })
  const mage = makeActor('mage', { tags: ['player'] })
  const slime = makeActor('slime', { tags: ['enemy'] })
  const goblin = makeActor('goblin', { tags: ['enemy'] })

  return {
    turn: 1,
    order: [hero.id, mage.id, slime.id, goblin.id],
    current: 0,
    rngSeed: 1,
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
