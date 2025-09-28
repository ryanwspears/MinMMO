import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PlayerProfile, WorldState } from '@game/save';

const SAVE_KEY = 'minmmo:save';

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
    localStorage.clear();
    vi.resetModules();
  });

  test('creates accounts and authenticates credentials', async () => {
    const save = await import('@game/save');
    save.resetSave();

    const account = save.createAccount('player-one', 's3cret');
    expect(account.id).toBe('player-one');
    expect(account.passwordHash).not.toBe('s3cret');

    const accounts = save.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].characterCount).toBe(0);

    expect(save.authenticateAccount('player-one', 's3cret')).toBe(true);
    expect(save.authenticateAccount('player-one', 'wrong')).toBe(false);
  });

  test('persists characters and active selection', async () => {
    const save = await import('@game/save');
    save.resetSave();

    const account = save.createAccount('player-two', 'pw');
    const profile = buildProfile('Alys');
    const world = buildWorld();
    const character = save.upsertCharacter(account.id, { profile, world });

    expect(character.profile.name).toBe('Alys');
    expect(save.listCharacters(account.id)).toHaveLength(1);

    save.selectActiveCharacter(account.id, character.id);
    expect(save.getActiveProfile()?.name).toBe('Alys');
    expect(save.getActiveWorld()?.turn).toBe(0);

    const updatedProfile = { ...profile, level: 2, stats: { ...profile.stats, lv: 2 } };
    const updatedWorld: WorldState = { ...world, turn: 4 };
    save.saveActiveCharacter(updatedProfile, updatedWorld);

    const stored = save.listCharacters(account.id)[0];
    expect(stored.profile.level).toBe(2);
    expect(stored.world.turn).toBe(4);
  });

  test('migrates legacy single-profile saves', async () => {
    const legacy = {
      profile: { ...buildProfile('Legacy Hero'), level: 3, stats: { ...buildProfile('Legacy Hero').stats, lv: 3 } },
      world: { ...buildWorld(), turn: 7 },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const save = await import('@game/save');
    const accounts = save.listAccounts();
    expect(accounts).toHaveLength(1);
    const accountId = accounts[0].id;

    const characters = save.listCharacters(accountId);
    expect(characters).toHaveLength(1);
    expect(characters[0].profile.name).toBe('Legacy Hero');
    expect(characters[0].world.turn).toBe(7);

    const selection = save.getActiveSelection();
    expect(selection.accountId).toBe(accountId);
    expect(selection.characterId).toBe(characters[0].id);
  });
});
