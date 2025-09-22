import type { GameConfig, ItemDef, SkillDef, StatusDef } from '@config/schema';
import type { Actor } from '@engine/battle/types';

export type RuntimeSkill = SkillDef;
export type RuntimeItem = ItemDef;
export type RuntimeStatusTemplate = StatusDef;

type EnemyFactory = (level: number) => Actor;

type AnyRecord<T> = Record<string, T>;

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepClone(entry);
    }
    return result as T;
  }
  return value;
}

export function toSkills(cfg: GameConfig): AnyRecord<RuntimeSkill> {
  const out: AnyRecord<RuntimeSkill> = {};
  for (const [id, def] of Object.entries(cfg.skills)) {
    out[id] = { id, ...deepClone(def) };
  }
  return out;
}

export function toItems(cfg: GameConfig): AnyRecord<RuntimeItem> {
  const out: AnyRecord<RuntimeItem> = {};
  for (const [id, def] of Object.entries(cfg.items)) {
    out[id] = { id, ...deepClone(def) };
  }
  return out;
}

export function toStatuses(cfg: GameConfig): AnyRecord<RuntimeStatusTemplate> {
  const out: AnyRecord<RuntimeStatusTemplate> = {};
  for (const [id, def] of Object.entries(cfg.statuses)) {
    out[id] = { id, ...deepClone(def) };
  }
  return out;
}

export function toEnemies(cfg: GameConfig): AnyRecord<EnemyFactory> {
  const out: AnyRecord<EnemyFactory> = {};
  for (const [id, def] of Object.entries(cfg.enemies)) {
    const base = def.base ?? {};
    out[id] = (level: number) => ({
      id,
      name: def.name ?? id,
      color: def.color,
      clazz: undefined,
      stats: {
        maxHp: base.maxHp ?? 1,
        hp: base.maxHp ?? 1,
        maxSta: base.maxSta ?? 0,
        sta: base.maxSta ?? 0,
        maxMp: base.maxMp ?? 0,
        mp: base.maxMp ?? 0,
        atk: base.atk ?? 0,
        def: base.def ?? 0,
        lv: level ?? 1,
        xp: 0,
        gold: 0,
      },
      statuses: [],
      alive: true,
      tags: def.tags ? [...def.tags] : [],
      meta: {
        skillIds: def.skills ? [...def.skills] : [],
        itemDrops: def.items ? def.items.map((item) => ({ ...item })) : undefined,
      },
    });
  }
  return out;
}
