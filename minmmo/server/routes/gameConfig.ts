import { Router } from 'express'
import { pool } from '../db.js'
import { validateAndRepair } from '@game-config/validate'
import type { GameConfig } from '@game-config/schema'

const CONFIG_KEY = 'game'

const router = Router()

async function readConfig(): Promise<GameConfig> {
  const { rows } = await pool.query<{ value: GameConfig }>('SELECT value FROM game_config WHERE key = $1', [CONFIG_KEY])
  if (rows.length === 0) {
    const repaired = validateAndRepair({})
    await pool.query('INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [CONFIG_KEY, repaired])
    return repaired
  }
  const stored = rows[0]?.value ?? {}
  const repaired = validateAndRepair(stored)
  if (JSON.stringify(stored) !== JSON.stringify(repaired)) {
    await pool.query('UPDATE game_config SET value = $2, updated_at = NOW() WHERE key = $1', [CONFIG_KEY, repaired])
  }
  return repaired
}

async function writeConfig(next: unknown): Promise<GameConfig> {
  const repaired = validateAndRepair(next)
  await pool.query(
    'INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [CONFIG_KEY, repaired],
  )
  return repaired
}

router.get('/', async (_req, res, next) => {
  try {
    const cfg = await readConfig()
    res.json(cfg)
  } catch (error) {
    next(error)
  }
})

router.put('/', async (req, res, next) => {
  try {
    const cfg = await writeConfig(req.body ?? {})
    res.json(cfg)
  } catch (error) {
    next(error)
  }
})

export default router
