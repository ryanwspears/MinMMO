import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.account_id, c.name, c.level, c.data, c.updated_at, a.username AS account_username
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       ORDER BY c.updated_at DESC`
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'Invalid character id' })
      return
    }
    const { rows } = await pool.query('SELECT * FROM characters WHERE id = $1', [id])
    if (rows.length === 0) {
      res.status(404).json({ message: 'Character not found' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  const { accountId, name, level, data } = req.body ?? {}
  const parsedAccountId = Number.parseInt(String(accountId), 10)
  if (Number.isNaN(parsedAccountId) || !name) {
    res.status(400).json({ message: 'accountId and name are required' })
    return
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO characters (account_id, name, level, data)
       VALUES ($1, $2, COALESCE($3, 1), COALESCE($4, '{}'::jsonb))
       RETURNING *`,
      [parsedAccountId, name, level, data]
    )
    res.status(201).json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.put('/:id', async (req, res, next) => {
  const { name, level, data } = req.body ?? {}
  try {
    const id = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'Invalid character id' })
      return
    }
    const { rows } = await pool.query(
      `UPDATE characters
       SET name = COALESCE($2, name),
           level = COALESCE($3, level),
           data = COALESCE($4, data),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, level, data]
    )
    if (rows.length === 0) {
      res.status(404).json({ message: 'Character not found' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'Invalid character id' })
      return
    }
    const { rowCount } = await pool.query('DELETE FROM characters WHERE id = $1', [id])
    if (rowCount === 0) {
      res.status(404).json({ message: 'Character not found' })
      return
    }
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

export default router
