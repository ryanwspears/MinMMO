import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'

const router = Router()

interface AccountSummaryRow {
  id: string
  character_count: string | number | null
  active_character_id: string | null
  created_at: Date | string | null
  updated_at: Date | string | null
}

interface CharacterRow {
  id: string
  account_id: string
  profile: any
  created_at: Date | string | null
  updated_at: Date | string | null
  last_selected_at: Date | string | null
  world: any
  inventory: any
}

function toEpoch(value: Date | string | null): number {
  if (!value) return Date.now()
  const date = value instanceof Date ? value : new Date(value)
  const epoch = Number.isFinite(date.valueOf()) ? date.valueOf() : Date.now()
  return epoch
}

function mapAccountSummary(row: AccountSummaryRow) {
  return {
    id: row.id,
    characterCount: Number(row.character_count ?? 0),
    activeCharacterId: row.active_character_id ?? undefined,
    createdAt: toEpoch(row.created_at ?? null),
    updatedAt: toEpoch(row.updated_at ?? null),
  }
}

function mapCharacter(row: CharacterRow) {
  const profile = row.profile && typeof row.profile === 'object' ? { ...row.profile } : {}
  const inventory = Array.isArray(row.inventory) ? row.inventory : []
  return {
    id: row.id,
    profile: { ...profile, inventory },
    world: row.world && typeof row.world === 'object' ? row.world : {},
    createdAt: toEpoch(row.created_at ?? null),
    updatedAt: toEpoch(row.updated_at ?? null),
    lastSelectedAt: row.last_selected_at ? toEpoch(row.last_selected_at) : undefined,
  }
}

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query<AccountSummaryRow>(
      `SELECT a.id, a.active_character_id, a.created_at, a.updated_at, COUNT(c.id) AS character_count
       FROM account_credentials a
       LEFT JOIN account_characters c ON c.account_id = a.id
       GROUP BY a.id
       ORDER BY a.created_at ASC`
    )
    res.json(rows.map(mapAccountSummary))
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!id || !password) {
    res.status(400).json({ message: 'id and password are required' })
    return
  }
  try {
    const hashed = await bcrypt.hash(password, 12)
    const { rows } = await pool.query<AccountSummaryRow>(
      `INSERT INTO account_credentials (id, password_hash)
       VALUES ($1, $2)
       RETURNING id, active_character_id, created_at, updated_at, 0 AS character_count`,
      [id, hashed]
    )
    res.status(201).json({
      id: rows[0].id,
      characters: {},
      activeCharacterId: rows[0].active_character_id ?? undefined,
      createdAt: toEpoch(rows[0].created_at ?? null),
      updatedAt: toEpoch(rows[0].updated_at ?? null),
    })
  } catch (error: any) {
    if (error?.code === '23505') {
      res.status(409).json({ message: 'Account already exists' })
      return
    }
    next(error)
  }
})

router.post('/authenticate', async (req, res, next) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!id) {
    res.status(400).json({ success: false, message: 'Account id is required' })
    return
  }
  try {
    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM account_credentials WHERE id = $1',
      [id]
    )
    if (rows.length === 0) {
      res.json({ success: false })
      return
    }
    const ok = await bcrypt.compare(password, rows[0].password_hash)
    res.json({ success: ok })
  } catch (error) {
    next(error)
  }
})

router.post('/:accountId/selection', async (req, res, next) => {
  const accountId = typeof req.params.accountId === 'string' ? req.params.accountId.trim() : ''
  if (!accountId) {
    res.status(400).json({ message: 'Invalid account id' })
    return
  }
  const characterId =
    typeof req.body?.characterId === 'string' && req.body.characterId
      ? req.body.characterId.trim()
      : null
  try {
    const accountResult = await pool.query('SELECT 1 FROM account_credentials WHERE id = $1', [accountId])
    if (accountResult.rowCount === 0) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    await pool.query(
      `UPDATE account_credentials
       SET active_character_id = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [accountId, characterId]
    )
    if (characterId) {
      const { rowCount } = await pool.query(
        `UPDATE account_characters
         SET last_selected_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND account_id = $2`,
        [characterId, accountId]
      )
      if (rowCount === 0) {
        res.status(404).json({ message: 'Character not found for account' })
        return
      }
    }
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

router.get('/:accountId/characters', async (req, res, next) => {
  const accountId = typeof req.params.accountId === 'string' ? req.params.accountId.trim() : ''
  if (!accountId) {
    res.status(400).json({ message: 'Invalid account id' })
    return
  }
  try {
    const accountExists = await pool.query('SELECT 1 FROM account_credentials WHERE id = $1', [accountId])
    if (accountExists.rowCount === 0) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    const { rows } = await pool.query<CharacterRow>(
      `SELECT c.id, c.account_id, c.profile, c.created_at, c.updated_at, c.last_selected_at,
              COALESCE(w.state, '{}'::jsonb) AS world,
              COALESCE(i.items, '[]'::jsonb) AS inventory
       FROM account_characters c
       LEFT JOIN character_world_states w ON w.character_id = c.id
       LEFT JOIN character_inventories i ON i.character_id = c.id
       WHERE c.account_id = $1
       ORDER BY COALESCE(c.last_selected_at, to_timestamp(0)) DESC, c.updated_at DESC`,
      [accountId]
    )
    res.json(rows.map(mapCharacter))
  } catch (error) {
    next(error)
  }
})

router.get('/:accountId/characters/:characterId', async (req, res, next) => {
  const accountId = typeof req.params.accountId === 'string' ? req.params.accountId.trim() : ''
  const characterId = typeof req.params.characterId === 'string' ? req.params.characterId.trim() : ''
  if (!accountId || !characterId) {
    res.status(400).json({ message: 'Invalid account or character id' })
    return
  }
  try {
    const { rows } = await pool.query<CharacterRow>(
      `SELECT c.id, c.account_id, c.profile, c.created_at, c.updated_at, c.last_selected_at,
              COALESCE(w.state, '{}'::jsonb) AS world,
              COALESCE(i.items, '[]'::jsonb) AS inventory
       FROM account_characters c
       LEFT JOIN character_world_states w ON w.character_id = c.id
       LEFT JOIN character_inventories i ON i.character_id = c.id
       WHERE c.account_id = $1 AND c.id = $2`,
      [accountId, characterId]
    )
    if (rows.length === 0) {
      res.status(404).json({ message: 'Character not found' })
      return
    }
    res.json(mapCharacter(rows[0]))
  } catch (error) {
    next(error)
  }
})

export default router
