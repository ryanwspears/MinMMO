import type { GameConfig, NPCDef } from '@config/schema';
import { toEnemies, toItems, toSkills, toStatuses } from '@content/adapters';
import type { RuntimeItem, RuntimeSkill, RuntimeStatusTemplate } from '@content/adapters';
import type { Actor } from '@engine/battle/types';

type EnemyFactory = (level: number) => Actor;

type SkillMap = Record<string, RuntimeSkill>;
type ItemMap = Record<string, RuntimeItem>;
type StatusMap = Record<string, RuntimeStatusTemplate>;
type EnemyMap = Record<string, EnemyFactory>;
type NPCMap = Record<string, NPCDef>;

let skills: SkillMap = {};
let items: ItemMap = {};
let statuses: StatusMap = {};
let enemies: EnemyMap = {};
let npcs: NPCMap = {};

export function rebuildFromConfig(cfg: GameConfig) {
  skills = toSkills(cfg);
  items = toItems(cfg);
  statuses = toStatuses(cfg);
  enemies = toEnemies(cfg);
  npcs = { ...cfg.npcs };
}

export const Skills = () => skills;
export const Items = () => items;
export const Statuses = () => statuses;
export const Enemies = () => enemies;
export const NPCs = () => npcs;
