
import type { GameConfig } from '@config/schema'

let skills:  Record<string, any> = {}
let items:   Record<string, any> = {}
let statuses:Record<string, any> = {}
let enemies: Record<string, any> = {}
let npcs:    Record<string, any> = {}

export function rebuildFromConfig(cfg: GameConfig) {
  skills = { ...cfg.skills }
  items = { ...cfg.items }
  statuses = { ...cfg.statuses }
  enemies = { ...cfg.enemies }
  npcs = { ...cfg.npcs }
}

export const Skills   = () => skills
export const Items    = () => items
export const Statuses = () => statuses
export const Enemies  = () => enemies
export const NPCs     = () => npcs
