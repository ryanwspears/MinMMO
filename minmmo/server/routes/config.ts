import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM game_config ORDER BY key ASC')
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

router.get('/:key', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM game_config WHERE key = $1', [req.params.key])
    if (rows.length === 0) {
      res.status(404).json({ message: 'Config not found' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  const { key, value } = req.body ?? {}
  if (!key || typeof value === 'undefined') {
    res.status(400).json({ message: 'Both key and value are required' })
    return
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO game_config (key, value) VALUES ($1, $2) RETURNING key, value',
      [key, value]
    )
    res.status(201).json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.put('/:key', async (req, res, next) => {
  const { value } = req.body ?? {}
  if (typeof value === 'undefined') {
    res.status(400).json({ message: 'Value is required' })
    return
  }
  try {
    const { rows } = await pool.query(
      'UPDATE game_config SET value = $2, updated_at = NOW() WHERE key = $1 RETURNING key, value',
      [req.params.key, value]
    )
    if (rows.length === 0) {
      res.status(404).json({ message: 'Config not found' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.delete('/:key', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM game_config WHERE key = $1', [req.params.key])
    if (rowCount === 0) {
      res.status(404).json({ message: 'Config not found' })
      return
    }
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

export default router
