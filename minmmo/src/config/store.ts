import type { GameConfig } from './schema';
import { validateAndRepair } from '@content/validate';

const KEY = 'minmmo:config';
const storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage;
let current: GameConfig = validateAndRepair({});
const subs = new Set<(cfg: GameConfig) => void>();

function write(cfg: GameConfig) {
  current = cfg;
  if (storage) {
    storage.setItem(KEY, JSON.stringify(cfg));
  }
  for (const fn of subs) fn(current);
}

export function load(): GameConfig {
  try {
    if (!storage) {
      current = validateAndRepair({});
      return current;
    }
    const raw = storage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const repaired = validateAndRepair(parsed);
    current = repaired;
    storage.setItem(KEY, JSON.stringify(repaired));
  } catch {
    const repaired = validateAndRepair({});
    current = repaired;
    if (storage) {
      storage.setItem(KEY, JSON.stringify(repaired));
    }
  }
  return current;
}

export function save(cfg: GameConfig) {
  const repaired = validateAndRepair(cfg);
  write(repaired);
}

export function exportConfig(): string {
  return JSON.stringify(current, null, 2);
}

export function importConfig(json: string) {
  const parsed = JSON.parse(json);
  const repaired = validateAndRepair(parsed);
  write(repaired);
}

export function subscribe(fn: (cfg: GameConfig) => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export const CONFIG = () => current;
