
import type { GameConfig } from './schema'

export const DEFAULTS: GameConfig = {
  __version: 1,
  classes: { Knight: { maxHp:30, maxSta:12, maxMp:4, atk:5, def:6 }, Rogue: { maxHp:24, maxSta:16, maxMp:6, atk:6, def:3 }, Mage: { maxHp:20, maxSta:10, maxMp:16, atk:7, def:2 } } as any,
  classSkills: { Knight: [], Rogue: [], Mage: [] },
  startItems:  { Knight: [], Rogue: [], Mage: [] },
  skills: {},
  items: {},
  statuses: {},
  enemies: {},
  balance: {
    BASE_HIT: 0.85, BASE_CRIT: 0.05, CRIT_MULT: 1.5, DODGE_FLOOR: 0.05, HIT_CEIL: 0.99,
    ELEMENT_MATRIX: { neutral: { neutral: 1 } },
    RESISTS_BY_TAG: {},
    FLEE_BASE: 0.25,
    ECONOMY: { buyMult: 1.0, sellMult: 0.5, restockTurns: 5, priceByRarity: { common: 10, uncommon: 25, rare: 60, epic: 150 } },
    XP_CURVE: { base: 5, growth: 1.6 },
    GOLD_DROP: { mean: 5, variance: 2 },
    LOOT_ROLLS: 1,
    LEVEL_UNLOCK_INTERVAL: 10,
    SKILL_SLOTS_BY_LEVEL: [2,2,3,3,4,4,5,5]
  },
  elements: ['neutral'],
  tags: ['humanoid','beast','slime','elemental'],
  npcs: {}
}
