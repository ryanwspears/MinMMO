import type { InventoryEntry, Stats } from '@engine/battle/types'
import {
  authenticateAccountRequest,
  createAccountRequest,
  getCharacterRequest,
  listAccountsRequest,
  listCharactersRequest,
  selectActiveCharacterRequest,
  upsertCharacterRequest,
} from './api/saveClient'

export interface PlayerProfile {
  name: string
  clazz: string
  level: number
  xp: number
  gold: number
  stats: Stats
  unlockedSkills: string[]
  equippedSkills: string[]
  inventory: InventoryEntry[]
}

export interface MerchantStockEntry {
  id: string
  qty: number
  basePrice: number
}

export interface MerchantState {
  stock: MerchantStockEntry[]
  restockIn: number
}

export interface WorldState {
  merchants: Record<string, MerchantState>
  flags: Record<string, boolean>
  turn: number
  lastLocation?: string
  lastOverworldPosition?: { x: number; y: number }
  defeatedSpawnZones: string[]
}

export interface CharacterRecord {
  id: string
  profile: PlayerProfile
  world: WorldState
  createdAt: number
  updatedAt: number
  lastSelectedAt?: number
}

export interface AccountRecord {
  id: string
  characters: Record<string, CharacterRecord>
  activeCharacterId?: string
  createdAt: number
  updatedAt: number
}

export interface AccountSummary {
  id: string
  characterCount: number
  activeCharacterId?: string
  createdAt: number
  updatedAt: number
}

export interface ActiveSelection {
  accountId?: string
  characterId?: string
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepClone(entry)
    }
    return result as T
  }
  return value
}

function defaultWorld(): WorldState {
  return { merchants: {}, flags: {}, turn: 0, defeatedSpawnZones: [] }
}

export function createDefaultWorld(): WorldState {
  return defaultWorld()
}

function sanitizePoint(value: any): { x: number; y: number } | undefined {
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined
  }
  return { x, y }
}

function sanitizeProfile(input: any): PlayerProfile {
  const stats = (input?.stats ?? {}) as Partial<Stats>
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
  }
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
  }
}

function sanitizeWorld(input: any): WorldState {
  const merchants: Record<string, MerchantState> = {}
  if (input && typeof input.merchants === 'object') {
    for (const [id, state] of Object.entries(input.merchants as Record<string, any>)) {
      if (!id) continue
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
      }
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
    defeatedSpawnZones: Array.isArray(input?.defeatedSpawnZones)
      ? Array.from(
          new Set(
            input.defeatedSpawnZones
              .filter((id: unknown): id is string => typeof id === 'string')
              .map((id: string) => id.trim())
              .filter((id: string) => id.length > 0),
          ),
        )
      : [],
  }
}

function sanitizeCharacterRecord(input: any): CharacterRecord {
  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (!id) {
    throw new Error('Character id is required.')
  }
  const createdAt = Number.isFinite(Number(input?.createdAt)) ? Number(input.createdAt) : Date.now()
  const updatedAt = Number.isFinite(Number(input?.updatedAt)) ? Number(input.updatedAt) : createdAt
  const lastSelectedAt = Number.isFinite(Number(input?.lastSelectedAt))
    ? Number(input.lastSelectedAt)
    : undefined
  return {
    id,
    profile: sanitizeProfile(input?.profile ?? {}),
    world: sanitizeWorld(input?.world ?? {}),
    createdAt,
    updatedAt,
    lastSelectedAt,
  }
}

function sanitizeAccountRecord(input: any): AccountRecord {
  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (!id) {
    throw new Error('Account id is required.')
  }
  const createdAt = Number.isFinite(Number(input?.createdAt)) ? Number(input.createdAt) : Date.now()
  const updatedAt = Number.isFinite(Number(input?.updatedAt)) ? Number(input.updatedAt) : createdAt
  const activeCharacterId =
    typeof input?.activeCharacterId === 'string' && input.activeCharacterId
      ? input.activeCharacterId
      : undefined
  const characters: Record<string, CharacterRecord> = {}
  if (input && typeof input.characters === 'object') {
    for (const [key, value] of Object.entries(input.characters as Record<string, any>)) {
      try {
        const record = sanitizeCharacterRecord({ ...value, id: key })
        characters[record.id] = record
      } catch {
        // ignore malformed characters
      }
    }
  }
  return { id, characters, activeCharacterId, createdAt, updatedAt }
}

function sanitizeAccountSummary(input: any): AccountSummary | undefined {
  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (!id) {
    return undefined
  }
  const createdAt = Number.isFinite(Number(input?.createdAt)) ? Number(input.createdAt) : Date.now()
  const updatedAt = Number.isFinite(Number(input?.updatedAt)) ? Number(input?.updatedAt) : createdAt
  const characterCount = Number.isFinite(Number(input?.characterCount))
    ? Number(input.characterCount)
    : 0
  const activeCharacterId =
    typeof input?.activeCharacterId === 'string' && input.activeCharacterId
      ? input.activeCharacterId
      : undefined
  return { id, characterCount, activeCharacterId, createdAt, updatedAt }
}

let activeSelection: ActiveSelection = {}
let activeCharacter: CharacterRecord | undefined

export async function listAccounts(): Promise<AccountSummary[]> {
  const response = await listAccountsRequest()
  if (!Array.isArray(response)) {
    return []
  }
  const summaries: AccountSummary[] = []
  for (const entry of response) {
    const summary = sanitizeAccountSummary(entry)
    if (summary) {
      summaries.push(summary)
    }
  }
  return summaries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export async function createAccount(accountId: string, password: string): Promise<AccountRecord> {
  const id = String(accountId ?? '').trim()
  if (!id) {
    throw new Error('Account ID is required.')
  }
  const response = await createAccountRequest(id, password)
  const account = sanitizeAccountRecord(response)
  activeSelection = { accountId: account.id }
  activeCharacter = undefined
  return deepClone(account)
}

export async function authenticateAccount(accountId: string, password: string): Promise<boolean> {
  const id = String(accountId ?? '').trim()
  if (!id) {
    return false
  }
  try {
    const response = await authenticateAccountRequest(id, password)
    if (response?.success) {
      activeSelection = { accountId: id }
      activeCharacter = undefined
      return true
    }
    return false
  } catch (error) {
    console.error('Failed to authenticate account', error)
    return false
  }
}

export async function listCharacters(accountId: string): Promise<CharacterRecord[]> {
  const id = String(accountId ?? '').trim()
  if (!id) {
    throw new Error('Account ID is required.')
  }
  const response = await listCharactersRequest(id)
  if (!Array.isArray(response)) {
    return []
  }
  const characters: CharacterRecord[] = []
  for (const entry of response) {
    try {
      characters.push(sanitizeCharacterRecord(entry))
    } catch {
      // ignore invalid entries
    }
  }
  characters.sort((a, b) => {
    const selA = a.lastSelectedAt ?? 0
    const selB = b.lastSelectedAt ?? 0
    if (selA !== selB) return selB - selA
    return b.updatedAt - a.updatedAt
  })
  return characters.map((character) => deepClone(character))
}

export async function upsertCharacter(
  accountId: string,
  data: { id?: string; profile: PlayerProfile; world: WorldState },
): Promise<CharacterRecord> {
  const id = String(accountId ?? '').trim()
  if (!id) {
    throw new Error('Account ID is required.')
  }
  const payload = {
    id: data.id ? String(data.id).trim() || undefined : undefined,
    profile: sanitizeProfile(data.profile),
    world: sanitizeWorld(data.world),
  }
  const response = await upsertCharacterRequest(id, payload)
  const record = sanitizeCharacterRecord(response)
  if (activeSelection.accountId === id && activeSelection.characterId === record.id) {
    activeCharacter = record
  }
  return deepClone(record)
}

export async function selectActiveCharacter(
  accountId: string | null,
  characterId?: string | null,
): Promise<ActiveSelection> {
  if (!accountId) {
    activeSelection = {}
    activeCharacter = undefined
    return {}
  }
  const id = String(accountId ?? '').trim()
  if (!id) {
    activeSelection = {}
    activeCharacter = undefined
    return {}
  }
  const character = characterId ? String(characterId).trim() : ''
  await selectActiveCharacterRequest(id, character || null)
  if (character) {
    const response = await getCharacterRequest(id, character)
    const record = sanitizeCharacterRecord(response)
    activeSelection = { accountId: id, characterId: record.id }
    activeCharacter = record
  } else {
    activeSelection = { accountId: id }
    activeCharacter = undefined
  }
  return { ...activeSelection }
}

export function getActiveSelection(): ActiveSelection {
  return { ...activeSelection }
}

export function getActiveProfile(): PlayerProfile | undefined {
  return activeCharacter ? deepClone(activeCharacter.profile) : undefined
}

export function getActiveWorld(): WorldState | undefined {
  return activeCharacter ? deepClone(activeCharacter.world) : undefined
}

export function getProfile(): PlayerProfile | undefined {
  return getActiveProfile()
}

export function getWorld(): WorldState {
  const world = getActiveWorld()
  return world ? world : defaultWorld()
}

export async function saveActiveCharacter(profile: PlayerProfile, world: WorldState) {
  const selection = getActiveSelection()
  if (!selection.accountId || !selection.characterId) {
    return
  }
  const record = await upsertCharacter(selection.accountId, {
    id: selection.characterId,
    profile,
    world,
  })
  activeCharacter = record
}

export async function saveAll(profile: PlayerProfile | undefined, world: WorldState) {
  if (!profile) {
    return
  }
  await saveActiveCharacter(profile, world)
}

export function resetSave() {
  activeSelection = {}
  activeCharacter = undefined
}

export function mergeInventoryEntry(inventory: InventoryEntry[], entry: InventoryEntry) {
  if (!entry.id || !Number.isFinite(entry.qty)) return
  const existing = inventory.find((item) => item.id === entry.id)
  if (existing) {
    existing.qty += entry.qty
  } else {
    inventory.push({ id: entry.id, qty: entry.qty })
  }
  if (existing && existing.qty <= 0) {
    const idx = inventory.indexOf(existing)
    if (idx >= 0) inventory.splice(idx, 1)
  }
}

export function clampInventory(inventory: InventoryEntry[]) {
  for (let i = inventory.length - 1; i >= 0; i -= 1) {
    if (inventory[i].qty <= 0) {
      inventory.splice(i, 1)
    }
  }
}
