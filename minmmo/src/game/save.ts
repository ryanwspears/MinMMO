import type { InventoryEntry, Stats } from '@engine/battle/types';

export interface PlayerProfile {
  name: string;
  clazz: string;
  level: number;
  xp: number;
  gold: number;
  stats: Stats;
  unlockedSkills: string[];
  equippedSkills: string[];
  inventory: InventoryEntry[];
}

export interface MerchantStockEntry {
  id: string;
  qty: number;
  basePrice: number;
}

export interface MerchantState {
  stock: MerchantStockEntry[];
  restockIn: number;
}

export interface WorldState {
  merchants: Record<string, MerchantState>;
  flags: Record<string, boolean>;
  turn: number;
  lastLocation?: string;
}

export interface SaveData {
  profile?: PlayerProfile;
  world: WorldState;
}

const SAVE_KEY = 'minmmo:save';
const storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage;

function defaultWorld(): WorldState {
  return { merchants: {}, flags: {}, turn: 0 };
}

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

let cache: SaveData = { profile: undefined, world: defaultWorld() };

(function init() {
  if (!storage) {
    return;
  }
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    cache = normalizeSave(parsed);
  } catch {
    cache = { profile: undefined, world: defaultWorld() };
  }
})();

function normalizeSave(input: any): SaveData {
  const world = input && typeof input.world === 'object' ? input.world : {};
  return {
    profile: input && typeof input.profile === 'object' ? sanitizeProfile(input.profile) : undefined,
    world: sanitizeWorld(world),
  };
}

function sanitizeProfile(input: any): PlayerProfile {
  const stats = (input?.stats ?? {}) as Partial<Stats>;
  const safeStats: Stats = {
    maxHp: Number(stats.maxHp) || 1,
    hp: Number(stats.hp) || Number(stats.maxHp) || 1,
    maxSta: Number(stats.maxSta) || 0,
    sta: Number(stats.sta) || Number(stats.maxSta) || 0,
    maxMp: Number(stats.maxMp) || 0,
    mp: Number(stats.mp) || Number(stats.maxMp) || 0,
    atk: Number(stats.atk) || 1,
    def: Number(stats.def) || 0,
    lv: Number(stats.lv) || Number(input?.level) || 1,
    xp: Number(stats.xp) || Number(input?.xp) || 0,
    gold: Number(stats.gold) || Number(input?.gold) || 0,
  };
  return {
    name: typeof input?.name === 'string' && input.name ? input.name : 'Adventurer',
    clazz: typeof input?.clazz === 'string' && input.clazz ? input.clazz : 'Knight',
    level: Number(input?.level) || safeStats.lv || 1,
    xp: Number(input?.xp) || safeStats.xp || 0,
    gold: Number(input?.gold) || safeStats.gold || 0,
    stats: safeStats,
    unlockedSkills: Array.isArray(input?.unlockedSkills)
      ? Array.from(new Set(input.unlockedSkills.filter((id: unknown) => typeof id === 'string')))
      : [],
    equippedSkills: Array.isArray(input?.equippedSkills)
      ? Array.from(new Set(input.equippedSkills.filter((id: unknown) => typeof id === 'string')))
      : [],
    inventory: Array.isArray(input?.inventory)
      ? input.inventory
          .map((entry: any) => ({ id: String(entry?.id ?? ''), qty: Number(entry?.qty) || 0 }))
          .filter((entry: InventoryEntry) => entry.id && entry.qty > 0)
      : [],
  };
}

function sanitizeWorld(input: any): WorldState {
  const merchants: Record<string, MerchantState> = {};
  if (input && typeof input.merchants === 'object') {
    for (const [id, state] of Object.entries(input.merchants as Record<string, any>)) {
      if (!id) continue;
      merchants[id] = {
        stock: Array.isArray(state?.stock)
          ? state.stock
              .map((entry: any) => ({
                id: String(entry?.id ?? ''),
                qty: Number(entry?.qty) || 0,
                basePrice: Number(entry?.basePrice) || 0,
              }))
              .filter((entry: MerchantStockEntry) => entry.id && entry.qty > 0)
          : [],
        restockIn: Math.max(0, Number(state?.restockIn) || 0),
      };
    }
  }
  return {
    merchants,
    flags: input && typeof input.flags === 'object' ? { ...input.flags } : {},
    turn: Math.max(0, Number(input?.turn) || 0),
    lastLocation: typeof input?.lastLocation === 'string' ? input.lastLocation : undefined,
  };
}

function persist() {
  if (!storage) return;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

export function getSave(): SaveData {
  return deepClone(cache);
}

export function getProfile(): PlayerProfile | undefined {
  return cache.profile ? deepClone(cache.profile) : undefined;
}

export function setProfile(profile: PlayerProfile | undefined) {
  cache.profile = profile ? deepClone(profile) : undefined;
  persist();
}

export function getWorld(): WorldState {
  if (!cache.world) {
    cache.world = defaultWorld();
  }
  return deepClone(cache.world);
}

export function setWorld(world: WorldState) {
  cache.world = deepClone(world);
  persist();
}

export function saveAll(profile: PlayerProfile | undefined, world: WorldState) {
  cache = {
    profile: profile ? deepClone(profile) : undefined,
    world: deepClone(world),
  };
  persist();
}

export function resetSave() {
  cache = { profile: undefined, world: defaultWorld() };
  persist();
}

export function mergeInventoryEntry(inventory: InventoryEntry[], entry: InventoryEntry) {
  if (!entry.id || !Number.isFinite(entry.qty)) return;
  const existing = inventory.find((item) => item.id === entry.id);
  if (existing) {
    existing.qty += entry.qty;
  } else {
    inventory.push({ id: entry.id, qty: entry.qty });
  }
  if (existing && existing.qty <= 0) {
    const idx = inventory.indexOf(existing);
    if (idx >= 0) inventory.splice(idx, 1);
  }
}

export function clampInventory(inventory: InventoryEntry[]) {
  for (let i = inventory.length - 1; i >= 0; i -= 1) {
    if (inventory[i].qty <= 0) {
      inventory.splice(i, 1);
    }
  }
}
