import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PlayerProfile, WorldState } from '@game/save';
import {
  authenticateAccountRequest,
  createAccountRequest,
  getCharacterRequest,
  listAccountsRequest,
  listCharactersRequest,
  selectActiveCharacterRequest,
  upsertCharacterRequest,
} from '@game/api/saveClient';

vi.mock('@game/api/saveClient', () => ({
  authenticateAccountRequest: vi.fn(),
  createAccountRequest: vi.fn(),
  getCharacterRequest: vi.fn(),
  listAccountsRequest: vi.fn(),
  listCharactersRequest: vi.fn(),
  selectActiveCharacterRequest: vi.fn(),
  upsertCharacterRequest: vi.fn(),
  setSaveApiBase: vi.fn(),
}));

const mockedAuthenticateAccountRequest = vi.mocked(authenticateAccountRequest);
const mockedCreateAccountRequest = vi.mocked(createAccountRequest);
const mockedGetCharacterRequest = vi.mocked(getCharacterRequest);
const mockedListAccountsRequest = vi.mocked(listAccountsRequest);
const mockedListCharactersRequest = vi.mocked(listCharactersRequest);
const mockedSelectActiveCharacterRequest = vi.mocked(selectActiveCharacterRequest);
const mockedUpsertCharacterRequest = vi.mocked(upsertCharacterRequest);

function buildProfile(name = 'Hero'): PlayerProfile {
  return {
    name,
    clazz: 'Knight',
    level: 1,
    xp: 0,
    gold: 0,
    stats: {
      maxHp: 20,
      hp: 20,
      maxSta: 10,
      sta: 10,
      maxMp: 5,
      mp: 5,
      atk: 5,
      def: 3,
      lv: 1,
      xp: 0,
      gold: 0,
    },
    unlockedSkills: [],
    equippedSkills: [],
    inventory: [],
  };
}

function buildWorld(): WorldState {
  return {
    merchants: {},
    flags: {},
    turn: 0,
    defeatedSpawnZones: [],
  };
}

describe('save auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  test('creates accounts and authenticates credentials', async () => {
    const now = Date.now();
    mockedCreateAccountRequest.mockResolvedValue({
      id: 'player-one',
      characters: {},
      createdAt: now,
      updatedAt: now,
    });
    mockedListAccountsRequest.mockResolvedValue([
      { id: 'player-one', characterCount: 0, createdAt: now, updatedAt: now },
    ]);
    mockedAuthenticateAccountRequest.mockImplementation(async (_id: string, password: string) => ({
      success: password === 's3cret',
    }));

    const save = await import('@game/save');
    save.resetSave();

    const account = await save.createAccount('player-one', 's3cret');
    expect(account.id).toBe('player-one');
    expect(createAccountRequest).toHaveBeenCalledWith('player-one', 's3cret');

    const accounts = await save.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].characterCount).toBe(0);

    expect(await save.authenticateAccount('player-one', 's3cret')).toBe(true);
    expect(await save.authenticateAccount('player-one', 'wrong')).toBe(false);
  });

  test('persists characters and active selection', async () => {
    const now = Date.now();
    const profile = buildProfile('Alys');
    const world = buildWorld();
    const record = {
      id: 'char-1',
      profile,
      world,
      createdAt: now,
      updatedAt: now,
      lastSelectedAt: now,
    };
    const updatedProfile: PlayerProfile = { ...profile, level: 2, stats: { ...profile.stats, lv: 2 } };
    const updatedWorld: WorldState = { ...world, turn: 4 };
    const updatedRecord = {
      ...record,
      profile: updatedProfile,
      world: updatedWorld,
      updatedAt: now + 1000,
      lastSelectedAt: now + 1000,
    };

    mockedCreateAccountRequest.mockResolvedValue({
      id: 'player-two',
      characters: {},
      createdAt: now,
      updatedAt: now,
    });
    mockedListCharactersRequest.mockResolvedValueOnce([record]).mockResolvedValueOnce([updatedRecord]);
    mockedUpsertCharacterRequest.mockResolvedValueOnce(record).mockResolvedValueOnce(updatedRecord);
    mockedSelectActiveCharacterRequest.mockResolvedValue(undefined);
    mockedGetCharacterRequest.mockResolvedValueOnce(record).mockResolvedValueOnce(updatedRecord);

    const save = await import('@game/save');
    save.resetSave();

    const account = await save.createAccount('player-two', 'pw');
    const created = await save.upsertCharacter(account.id, { profile, world });
    expect(created.profile.name).toBe('Alys');

    const characters = await save.listCharacters(account.id);
    expect(characters).toHaveLength(1);

    await save.selectActiveCharacter(account.id, created.id);
    expect(save.getActiveProfile()?.name).toBe('Alys');
    expect(save.getActiveWorld()?.turn).toBe(0);

    await save.saveActiveCharacter(updatedProfile, updatedWorld);

    const stored = await save.listCharacters(account.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].profile.level).toBe(2);
    expect(stored[0].world.turn).toBe(4);
  });

  test('returns false when authentication request fails', async () => {
    mockedAuthenticateAccountRequest.mockRejectedValue(new Error('offline'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const save = await import('@game/save');
    save.resetSave();

    const ok = await save.authenticateAccount('player-one', 'pw');
    expect(ok).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
