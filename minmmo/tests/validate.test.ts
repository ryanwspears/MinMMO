import { describe, expect, it, beforeEach, vi } from 'vitest';
import { validateAndRepair } from '@content/validate';
import { DEFAULTS } from '@config/defaults';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

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
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
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
    const storage = new MemoryStorage();
    (globalThis as any).localStorage = storage;
    vi.resetModules();
    const store = await import('@config/store');
    store.importConfig(JSON.stringify(brokenConfig));
    const exported = JSON.parse(store.exportConfig());
    expect(exported.classes.Knight.maxHp).toBe(60);
    expect(exported.startItems.Knight).toEqual([]);
    expect(exported.classSkills.Knight).toEqual([]);
  });

  it('repairs persisted config on load', async () => {
    const storage = new MemoryStorage();
    storage.setItem('minmmo:config', JSON.stringify({
      __version: 1,
      startItems: { Knight: null },
    }));
    (globalThis as any).localStorage = storage;
    vi.resetModules();
    const store = await import('@config/store');
    const cfg = store.load();
    expect(cfg.startItems.Knight).toEqual([]);
    expect(cfg.classes).toEqual(DEFAULTS.classes);
  });
});
