import type { GameConfig } from './schema';
import { validateAndRepair } from '@content/validate';

const ENDPOINT = '/api/config';

let current: GameConfig = validateAndRepair({});
let hasHydrated = false;
let pendingLoad: Promise<GameConfig> | null = null;
const subs = new Set<(cfg: GameConfig) => void>();

function notify(cfg: GameConfig) {
  for (const fn of subs) fn(cfg);
}

async function parseResponse(response: Response): Promise<GameConfig> {
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  const payload = await response.json();
  return validateAndRepair(payload);
}

async function fetchFromServer(): Promise<GameConfig> {
  const response = await fetch(ENDPOINT, { method: 'GET' });
  return parseResponse(response);
}

async function pushToServer(cfg: GameConfig): Promise<GameConfig> {
  const response = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  return parseResponse(response);
}

async function resolveLoad(force?: boolean): Promise<GameConfig> {
  if (!force && hasHydrated) {
    return current;
  }
  if (!force && pendingLoad) {
    return pendingLoad;
  }
  const request = fetchFromServer()
    .then((cfg) => {
      current = cfg;
      hasHydrated = true;
      notify(cfg);
      return cfg;
    })
    .finally(() => {
      pendingLoad = null;
    });
  if (!force) {
    pendingLoad = request;
  }
  return request;
}

export async function load(options?: { force?: boolean }): Promise<GameConfig> {
  return resolveLoad(options?.force);
}

export async function save(cfg: GameConfig): Promise<GameConfig> {
  const repaired = validateAndRepair(cfg);
  const stored = await pushToServer(repaired);
  current = stored;
  hasHydrated = true;
  notify(current);
  return current;
}

export async function exportConfig(): Promise<string> {
  const cfg = hasHydrated ? current : await resolveLoad(false);
  return JSON.stringify(cfg, null, 2);
}

export async function importConfig(json: string): Promise<GameConfig> {
  const parsed = JSON.parse(json);
  const repaired = validateAndRepair(parsed);
  return save(repaired);
}

export function subscribe(fn: (cfg: GameConfig) => void) {
  subs.add(fn);
  if (hasHydrated) {
    fn(current);
  } else if (pendingLoad) {
    pendingLoad.then(fn).catch(() => {
      /* ignore */
    });
  }
  return () => {
    subs.delete(fn);
  };
}

export const CONFIG = () => current;
