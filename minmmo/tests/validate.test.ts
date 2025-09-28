import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { validateAndRepair } from '@content/validate';
import { DEFAULTS } from '@config/defaults';
import { useConfigApiMock, restoreConfigApiMock } from './helpers/configApiMock';

const brokenConfig = {
  __version: 1,
  classes: {
    Knight: { maxHp: 60 },
  },
  classSkills: { Knight: null },
  startItems: { Knight: null },
  skills: {},
  items: {},
  statuses: {},
  enemies: {},
  npcs: {},
};

describe('validateAndRepair', () => {
  let api: ReturnType<typeof useConfigApiMock>;

  beforeEach(() => {
    api = useConfigApiMock();
  });

  afterEach(() => {
    restoreConfigApiMock();
    vi.resetModules();
  });

  it('fills missing branches from defaults', () => {
    const repaired = validateAndRepair(brokenConfig as any);
    expect(repaired.classes.Knight.maxHp).toBe(60);
    expect(repaired.classes.Knight.def).toBe(DEFAULTS.classes.Knight.def);
    expect(repaired.classes.Rogue).toEqual(DEFAULTS.classes.Rogue);
    expect(repaired.startItems.Knight).toEqual([]);
    expect(repaired.classSkills.Knight).toEqual([]);
  });

  it('round-trips through import/export with repairs', async () => {
    vi.resetModules();
    const store = await import('@config/store');
    await store.importConfig(JSON.stringify(brokenConfig));
    const exported = JSON.parse(await store.exportConfig());
    expect(exported.classes.Knight.maxHp).toBe(60);
    expect(exported.startItems.Knight).toEqual([]);
    expect(exported.classSkills.Knight).toEqual([]);
  });

  it('repairs persisted config on load', async () => {
    api.setRawConfig({
      __version: 1,
      startItems: { Knight: null },
    });
    vi.resetModules();
    const store = await import('@config/store');
    const cfg = await store.load({ force: true });
    expect(cfg.startItems.Knight).toEqual([]);
    expect(cfg.classes).toEqual(DEFAULTS.classes);
  });
});
