
import { DEFAULTS } from './defaults'
import type { GameConfig } from './schema'

const KEY = 'minmmo:config'
let current: GameConfig = DEFAULTS
const subs = new Set<(cfg: GameConfig)=>void>()

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (Array.isArray(base)) return (patch as any) ?? base as any
  if (typeof base === 'object' && base) {
    const out: any = { ...base }
    for (const k of Object.keys(patch || {})) {
      const pv: any = (patch as any)[k]
      const bv: any = (base as any)[k]
      out[k] = (bv && typeof bv === 'object' && !Array.isArray(bv)) ? deepMerge(bv, pv || {}) : (pv ?? bv)
    }
    return out
  }
  return (patch as any) ?? base
}

export function load(): GameConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      current = DEFAULTS
    } else {
      const parsed = JSON.parse(raw)
      current = deepMerge(DEFAULTS, parsed)
    }
  } catch {
    current = DEFAULTS
  }
  return current
}

export function save(cfg: GameConfig) {
  current = deepMerge(DEFAULTS, cfg)
  localStorage.setItem(KEY, JSON.stringify(current))
  for (const fn of subs) fn(current)
}

export function exportConfig(): string {
  return JSON.stringify(current, null, 2)
}

export function importConfig(json: string) {
  const parsed = JSON.parse(json)
  save(parsed)
}

export function subscribe(fn: (cfg: GameConfig)=>void) {
  subs.add(fn)
  return () => subs.delete(fn)
}

export const CONFIG = () => current
