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
  lastOverworldPosition?: { x: number; y: number };
}

export interface CharacterRecord {
  id: string;
  profile: PlayerProfile;
  world: WorldState;
  createdAt: number;
  updatedAt: number;
  lastSelectedAt?: number;
}

export interface AccountRecord {
  id: string;
  passwordHash?: string;
  characters: Record<string, CharacterRecord>;
  activeCharacterId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveData {
  version: number;
  accounts: Record<string, AccountRecord>;
  activeAccountId?: string;
}

export interface AccountSummary {
  id: string;
  characterCount: number;
  activeCharacterId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveSelection {
  accountId?: string;
  characterId?: string;
}

const SAVE_KEY = 'minmmo:save';
const CURRENT_VERSION = 2;
const LEGACY_ACCOUNT_ID = 'solo';
const LEGACY_CHARACTER_ID = 'solo-hero';
const storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage;

function defaultWorld(): WorldState {
  return { merchants: {}, flags: {}, turn: 0 };
}

export function createDefaultWorld(): WorldState {
  return defaultWorld();
}

function defaultSave(): SaveData {
  return { version: CURRENT_VERSION, accounts: {} };
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

let cache: SaveData = defaultSave();

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
    cache = defaultSave();
  }
})();

function normalizeSave(input: any): SaveData {
  if (input && typeof input === 'object' && input.accounts && typeof input.accounts === 'object') {
    return sanitizeAccountsSave(input);
  }
  return migrateLegacySave(input);
}

function sanitizeAccountsSave(input: any): SaveData {
  const accountsInput = input.accounts ?? {};
  const accounts: Record<string, AccountRecord> = {};
  for (const [rawId, account] of Object.entries(accountsInput as Record<string, any>)) {
    const id = String(rawId ?? '').trim();
    if (!id) continue;
    const sanitized = sanitizeAccount(id, account);
    accounts[sanitized.id] = sanitized;
  }

  let activeAccountId: string | undefined;
  if (typeof input?.activeAccountId === 'string' && accounts[input.activeAccountId]) {
    activeAccountId = input.activeAccountId;
  }

  return {
    version: Number.isFinite(input?.version) ? Number(input.version) : CURRENT_VERSION,
    accounts,
    activeAccountId,
  };
}

function migrateLegacySave(input: any): SaveData {
  const profile = input && typeof input.profile === 'object' ? sanitizeProfile(input.profile) : undefined;
  const world = sanitizeWorld(input && typeof input.world === 'object' ? input.world : {});
  if (!profile) {
    return defaultSave();
  }

  const character: CharacterRecord = {
    id: LEGACY_CHARACTER_ID,
    profile,
    world,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const account: AccountRecord = {
    id: LEGACY_ACCOUNT_ID,
    passwordHash: undefined,
    characters: { [character.id]: character },
    activeCharacterId: character.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return {
    version: CURRENT_VERSION,
    accounts: { [account.id]: account },
    activeAccountId: account.id,
  };
}

function sanitizeAccount(id: string, input: any): AccountRecord {
  const characters: Record<string, CharacterRecord> = {};
  if (input && typeof input.characters === 'object') {
    for (const [rawId, character] of Object.entries(input.characters as Record<string, any>)) {
      const charId = String(rawId ?? '').trim();
      if (!charId) continue;
      const sanitized = sanitizeCharacter(charId, character);
      characters[sanitized.id] = sanitized;
    }
  }

  let activeCharacterId: string | undefined;
  if (typeof input?.activeCharacterId === 'string' && characters[input.activeCharacterId]) {
    activeCharacterId = input.activeCharacterId;
  }

  const createdAt = Number.isFinite(input?.createdAt) ? Number(input.createdAt) : Date.now();
  const updatedAt = Number.isFinite(input?.updatedAt) ? Number(input.updatedAt) : createdAt;
  const passwordHash = typeof input?.passwordHash === 'string' && input.passwordHash ? input.passwordHash : undefined;

  return {
    id,
    passwordHash,
    characters,
    activeCharacterId,
    createdAt,
    updatedAt,
  };
}

function sanitizeCharacter(id: string, input: any): CharacterRecord {
  const createdAt = Number.isFinite(input?.createdAt) ? Number(input.createdAt) : Date.now();
  const updatedAt = Number.isFinite(input?.updatedAt) ? Number(input.updatedAt) : createdAt;
  const lastSelectedAt = Number.isFinite(input?.lastSelectedAt) ? Number(input.lastSelectedAt) : undefined;
  return {
    id,
    profile: sanitizeProfile(input?.profile ?? {}),
    world: sanitizeWorld(input?.world ?? {}),
    createdAt,
    updatedAt,
    lastSelectedAt,
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
    lastOverworldPosition:
      input && typeof input.lastOverworldPosition === 'object'
        ? sanitizePoint(input.lastOverworldPosition)
        : undefined,
  };
}

function sanitizePoint(value: any): { x: number; y: number } | undefined {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x, y };
}

function persist() {
  if (!storage) return;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

function hashPassword(password: string): string {
  const str = String(password ?? '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function ensureAccount(accountId: string): AccountRecord {
  const id = String(accountId ?? '').trim();
  if (!id) {
    throw new Error('Account ID is required.');
  }
  const account = cache.accounts[id];
  if (!account) {
    throw new Error(`Account ${id} does not exist.`);
  }
  return account;
}

function generateCharacterId(account: AccountRecord): string {
  const base = `char-${Math.random().toString(36).slice(2, 8)}`;
  if (!account.characters[base]) return base;
  let i = 1;
  while (account.characters[`${base}-${i}`]) {
    i += 1;
  }
  return `${base}-${i}`;
}

function getActiveAccount(): AccountRecord | undefined {
  if (!cache.activeAccountId) return undefined;
  return cache.accounts[cache.activeAccountId];
}

function getActiveCharacterRecord(): CharacterRecord | undefined {
  const account = getActiveAccount();
  if (!account || !account.activeCharacterId) return undefined;
  return account.characters[account.activeCharacterId];
}

export function getSave(): SaveData {
  return deepClone(cache);
}

export function listAccounts(): AccountSummary[] {
  const entries = Object.values(cache.accounts).map((account) => ({
    id: account.id,
    characterCount: Object.keys(account.characters).length,
    activeCharacterId: account.activeCharacterId,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }));
  return entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function createAccount(accountId: string, password: string): AccountRecord {
  const id = String(accountId ?? '').trim();
  if (!id) {
    throw new Error('Account ID is required.');
  }
  if (cache.accounts[id]) {
    throw new Error('Account already exists.');
  }
  const now = Date.now();
  const account: AccountRecord = {
    id,
    passwordHash: hashPassword(password),
    characters: {},
    activeCharacterId: undefined,
    createdAt: now,
    updatedAt: now,
  };
  cache.accounts[id] = account;
  cache.activeAccountId = id;
  persist();
  return deepClone(account);
}

export function authenticateAccount(accountId: string, password: string): boolean {
  const id = String(accountId ?? '').trim();
  if (!id) {
    return false;
  }
  const account = cache.accounts[id];
  if (!account) {
    return false;
  }
  const hashed = hashPassword(password);
  if (account.passwordHash && account.passwordHash !== hashed) {
    return false;
  }
  if (!account.passwordHash && password) {
    return false;
  }
  cache.activeAccountId = id;
  account.updatedAt = Date.now();
  persist();
  return true;
}

export function listCharacters(accountId: string): CharacterRecord[] {
  const account = ensureAccount(accountId);
  return Object.values(account.characters)
    .map((character) => deepClone(character))
    .sort((a, b) => {
      const selA = a.lastSelectedAt ?? 0;
      const selB = b.lastSelectedAt ?? 0;
      if (selA !== selB) return selB - selA;
      return b.updatedAt - a.updatedAt;
    });
}

export function upsertCharacter(
  accountId: string,
  data: { id?: string; profile: PlayerProfile; world: WorldState },
): CharacterRecord {
  const account = ensureAccount(accountId);
  const id = data.id ? String(data.id).trim() : generateCharacterId(account);
  if (!id) {
    throw new Error('Character ID is required.');
  }
  const now = Date.now();
  const record: CharacterRecord = {
    id,
    profile: sanitizeProfile(data.profile),
    world: sanitizeWorld(data.world),
    createdAt: account.characters[id]?.createdAt ?? now,
    updatedAt: now,
    lastSelectedAt: account.characters[id]?.lastSelectedAt,
  };
  account.characters[id] = record;
  account.updatedAt = now;
  persist();
  return deepClone(record);
}

export function selectActiveCharacter(accountId: string | null, characterId?: string | null): ActiveSelection {
  if (!accountId) {
    cache.activeAccountId = undefined;
    persist();
    return {};
  }
  const account = ensureAccount(accountId);
  let activeCharacterId: string | undefined;
  if (characterId) {
    const id = String(characterId).trim();
    if (!id || !account.characters[id]) {
      throw new Error('Character does not exist.');
    }
    account.characters[id].lastSelectedAt = Date.now();
    activeCharacterId = id;
  } else {
    activeCharacterId = undefined;
  }
  account.activeCharacterId = activeCharacterId;
  cache.activeAccountId = account.id;
  persist();
  return getActiveSelection();
}

export function getActiveSelection(): ActiveSelection {
  const account = getActiveAccount();
  if (!account) {
    return {};
  }
  return { accountId: account.id, characterId: account.activeCharacterId };
}

export function getActiveProfile(): PlayerProfile | undefined {
  const record = getActiveCharacterRecord();
  return record ? deepClone(record.profile) : undefined;
}

export function getActiveWorld(): WorldState | undefined {
  const record = getActiveCharacterRecord();
  return record ? deepClone(record.world) : undefined;
}

export function getProfile(): PlayerProfile | undefined {
  return getActiveProfile();
}

export function getWorld(): WorldState {
  const world = getActiveWorld();
  return world ? world : defaultWorld();
}

export function saveActiveCharacter(profile: PlayerProfile, world: WorldState) {
  const selection = getActiveSelection();
  if (!selection.accountId || !selection.characterId) {
    return;
  }
  const account = ensureAccount(selection.accountId);
  const existing = account.characters[selection.characterId];
  const now = Date.now();
  const record: CharacterRecord = {
    id: selection.characterId,
    profile: sanitizeProfile(profile),
    world: sanitizeWorld(world),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSelectedAt: now,
  };
  account.characters[selection.characterId] = record;
  account.activeCharacterId = selection.characterId;
  account.updatedAt = now;
  persist();
}

export function saveAll(profile: PlayerProfile | undefined, world: WorldState) {
  if (!profile) {
    return;
  }
  saveActiveCharacter(profile, world);
}

export function resetSave() {
  cache = defaultSave();
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
