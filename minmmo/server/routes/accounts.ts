import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, created_at FROM accounts ORDER BY created_at DESC'
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
      res.status(400).json({ message: 'Invalid account id' })
      return
    }
    const { rows } = await pool.query(
      'SELECT id, username, email, created_at FROM accounts WHERE id = $1',
      [id]
    )
    if (rows.length === 0) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  const { username, email, passwordHash } = req.body ?? {}
  if (!username || !email || !passwordHash) {
    res.status(400).json({ message: 'username, email, and passwordHash are required' })
    return
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO accounts (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, passwordHash]
    )
    res.status(201).json(rows[0])
  } catch (error) {
    next(error)
  }
})

router.put('/:id', async (req, res, next) => {
  const { email, passwordHash } = req.body ?? {}
  if (typeof email === 'undefined' && typeof passwordHash === 'undefined') {
    res.status(400).json({ message: 'At least one field (email or passwordHash) must be provided' })
    return
  }
  try {
    const id = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'Invalid account id' })
      return
    }
    const { rows } = await pool.query(
      `UPDATE accounts
       SET email = COALESCE($2, email),
           password_hash = COALESCE($3, password_hash),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, username, email, created_at, updated_at`,
      [id, email, passwordHash]
    )
    if (rows.length === 0) {
      res.status(404).json({ message: 'Account not found' })
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
      res.status(400).json({ message: 'Invalid account id' })
      return
    }
    const { rowCount } = await pool.query('DELETE FROM accounts WHERE id = $1', [id])
    if (rowCount === 0) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

export default router
