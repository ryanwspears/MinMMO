import { describe, expect, it, vi } from 'vitest';
import type { Actor, BattleState } from '@engine/battle/types';
import type { TargetSelector } from '@config/schema';

vi.mock('phaser', () => {
  class Scene {
    scale = { width: 0, height: 0, on: () => {}, off: () => {} };
    add = {
      text: () => ({
        destroy: () => {},
        setInteractive: () => ({ on: () => {} }),
      }),
      graphics: () => ({
        clear: () => {},
        fillStyle: () => {},
        fillRect: () => {},
        lineStyle: () => {},
        strokeRect: () => {},
      }),
    };
    cameras = { resize: () => {} };
    events = { once: () => {} };
    layout?: unknown;
    constructor() {}
  }

  return {
    default: {
      Scene,
      GameObjects: { Text: class {}, Graphics: class {} },
      Structs: { Size: class {} },
    },
    Scene,
    GameObjects: { Text: class {}, Graphics: class {} },
    Structs: { Size: class {} },
  };
});

function makeActor(id: string, overrides: Partial<Actor> = {}) {
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
  };

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
  } satisfies Actor;
}

function createState(): BattleState {
  const hero = makeActor('hero', { tags: ['player'] });
  const mage = makeActor('mage', { tags: ['player'] });
  const slime = makeActor('slime', { tags: ['enemy'] });
  const goblin = makeActor('goblin', { tags: ['enemy'] });

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
  };
}

describe('Battle collectTargets', () => {
  it('limits manual selection to an active taunt source', async () => {
    const { Battle } = await import('@game/scenes/Battle');
    const scene = new Battle();
    (scene as any).state = createState();

    const selector: TargetSelector = { side: 'enemy', mode: 'single' };

    (scene as any).state.taunts.hero = { sourceId: 'goblin', turns: 1 };
    const forced = (scene as any).collectTargets(selector, 'hero');
    expect(forced).toEqual(['goblin']);

    (scene as any).state.actors.goblin.alive = false;
    const freed = (scene as any).collectTargets(selector, 'hero');
    expect(freed).toEqual(['slime']);
    expect((scene as any).state.taunts.hero).toBeUndefined();
  });
});
