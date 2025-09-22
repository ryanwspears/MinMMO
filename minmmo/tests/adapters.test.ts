import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '@config/defaults';
import { toEnemies, toItems, toSkills, toStatuses } from '@content/adapters';
import type { GameConfig } from '@config/schema';
import type { Actor } from '@engine/battle/types';

function cloneDefaults(): GameConfig {
  return JSON.parse(JSON.stringify(DEFAULTS)) as GameConfig;
}

describe('content adapters', () => {
  const cfg: GameConfig = cloneDefaults();

  cfg.skills = {
    fireball: {
      id: 'fireball',
      type: 'skill',
      name: 'Fireball',
      targeting: { side: 'enemy', mode: 'single' },
      effects: [
        {
          kind: 'damage',
          valueType: 'formula',
          formula: { expr: 'u.stats.atk * 4 - t.stats.def' },
          min: 5,
          max: 60,
          canCrit: true,
        },
      ],
      costs: { sta: 3 },
    },
  };

  cfg.items = {
    potion: {
      id: 'potion',
      type: 'item',
      name: 'Potion',
      targeting: { side: 'ally', mode: 'single' },
      effects: [
        {
          kind: 'heal',
          valueType: 'percent',
          percent: 25,
          min: 0,
          max: 1,
        },
      ],
      costs: { item: { id: 'potion', qty: 1 } },
      consumable: true,
    },
  };

  cfg.statuses = {
    burn: {
      id: 'burn',
      name: 'Burn',
      stackRule: 'stackCount',
      maxStacks: 3,
      durationTurns: 3,
      tags: ['fire'],
      modifiers: { shield: { id: 'burnShield', hp: 10 } },
      hooks: {
        onTurnEnd: [
          { kind: 'damage', valueType: 'flat', amount: 5 },
        ],
      },
    },
  };

  cfg.enemies = {
    slime: {
      name: 'Slime',
      color: 0x00ff00,
      base: { maxHp: 20, maxSta: 5, maxMp: 2, atk: 3, def: 1 },
      scale: { maxHp: 4, maxSta: 1, maxMp: 0, atk: 1, def: 0 },
      skills: ['fireball'],
      items: [{ id: 'potion', qty: 1 }],
      tags: ['slime'],
    },
  };

  const makeActor = (overrides: Partial<Actor['stats']>): Actor => ({
    id: 'hero',
    name: 'Hero',
    stats: {
      maxHp: 100,
      hp: 100,
      maxSta: 50,
      sta: 50,
      maxMp: 30,
      mp: 30,
      atk: 10,
      def: 5,
      lv: 5,
      xp: 0,
      gold: 0,
      ...overrides,
    },
    statuses: [],
    alive: true,
    tags: [],
  });

  it('compiles skills with formula values and clamps results', () => {
    const skills = toSkills(cfg);
    const fireball = skills.fireball;
    expect(fireball).toBeDefined();
    expect(fireball.effects[0].value.kind).toBe('formula');

    const userHigh = makeActor({ atk: 20 });
    const target = makeActor({ def: 0 });
    const resolvedHigh = fireball.effects[0].value.resolve(userHigh, target, {});
    expect(resolvedHigh).toBe(60);

    const userLow = makeActor({ atk: 0 });
    const resolvedLow = fireball.effects[0].value.resolve(userLow, target, {});
    expect(resolvedLow).toBe(5);

    expect(fireball.costs.sta).toBe(3);
    expect(fireball.targeting.includeDead).toBe(false);
  });

  it('compiles items with percent values and normalized costs', () => {
    const items = toItems(cfg);
    const potion = items.potion;
    expect(potion).toBeDefined();
    expect(potion.effects[0].value.kind).toBe('percent');
    expect(potion.effects[0].value.resolve(makeActor({}), makeActor({}), {})).toBeCloseTo(0.25);
    expect(potion.costs.item).toEqual({ id: 'potion', qty: 1 });
    expect(potion.consumable).toBe(true);
  });

  it('builds enemy factories that scale stats by level', () => {
    const enemies = toEnemies(cfg);
    const slimeFactory = enemies.slime;
    const slime = slimeFactory(5);
    expect(slime.stats.lv).toBe(5);
    expect(slime.stats.maxHp).toBe(20 + 4 * 5);
    expect(slime.stats.hp).toBe(slime.stats.maxHp);
    expect(slime.tags).toEqual(['slime']);
    expect(slime.meta?.skillIds).toEqual(['fireball']);
  });

  it('converts statuses into runtime templates with hooks', () => {
    const statuses = toStatuses(cfg);
    const burn = statuses.burn;
    expect(burn.stackRule).toBe('stackCount');
    expect(burn.maxStacks).toBe(3);
    expect(burn.durationTurns).toBe(3);
    expect(burn.tags).toEqual(['fire']);
    expect(burn.modifiers?.shield?.id).toBe('burnShield');
    expect(burn.hooks.onTurnEnd).toHaveLength(1);

    const user = makeActor({});
    const target = makeActor({});
    expect(burn.hooks.onTurnEnd[0].value.resolve(user, target, {})).toBe(5);
    expect(burn.hooks.onApply).toHaveLength(0);
  });
});
