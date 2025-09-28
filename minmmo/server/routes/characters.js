import { Router } from 'express';
import { pool } from '../db.js';
const router = Router();
function toEpoch(value) {
    if (!value)
        return Date.now();
    const date = value instanceof Date ? value : new Date(value);
    const epoch = Number.isFinite(date.valueOf()) ? date.valueOf() : Date.now();
    return epoch;
}
function mapCharacter(row) {
    const profile = row.profile && typeof row.profile === 'object' ? { ...row.profile } : {};
    const inventory = Array.isArray(row.inventory) ? row.inventory : [];
    return {
        id: row.id,
        profile: { ...profile, inventory },
        world: row.world && typeof row.world === 'object' ? row.world : {},
        createdAt: toEpoch(row.created_at ?? null),
        updatedAt: toEpoch(row.updated_at ?? null),
        lastSelectedAt: row.last_selected_at ? toEpoch(row.last_selected_at) : undefined,
    };
}
function extractProfile(input) {
    if (!input || typeof input !== 'object') {
        return { profile: {}, inventory: [] };
    }
    const { inventory, ...rest } = input;
    const items = Array.isArray(inventory) ? inventory : [];
    return { profile: rest, inventory: items };
}
function sanitizeWorld(input) {
    if (!input || typeof input !== 'object')
        return {};
    return input;
}
function generateCharacterId() {
    return `char-${Math.random().toString(36).slice(2, 10)}`;
}
async function fetchCharacterRow(characterId) {
    const { rows } = await pool.query(`SELECT c.id, c.account_id, c.profile, c.created_at, c.updated_at, c.last_selected_at,
            COALESCE(w.state, '{}'::jsonb) AS world,
            COALESCE(i.items, '[]'::jsonb) AS inventory
     FROM account_characters c
     LEFT JOIN character_world_states w ON w.character_id = c.id
     LEFT JOIN character_inventories i ON i.character_id = c.id
     WHERE c.id = $1`, [characterId]);
    return rows[0];
}
router.post('/', async (req, res, next) => {
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId.trim() : '';
    if (!accountId) {
        res.status(400).json({ message: 'accountId is required' });
        return;
    }
    try {
        const accountExists = await pool.query('SELECT 1 FROM account_credentials WHERE id = $1', [accountId]);
        if (accountExists.rowCount === 0) {
            res.status(404).json({ message: 'Account not found' });
            return;
        }
        const providedId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
        const { profile, inventory } = extractProfile(req.body?.profile);
        const world = sanitizeWorld(req.body?.world);
        let characterId = providedId || generateCharacterId();
        let attempts = 0;
        while (attempts < 5) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(`INSERT INTO account_characters (id, account_id, profile)
           VALUES ($1, $2, $3)`, [characterId, accountId, profile]);
                await client.query(`INSERT INTO character_world_states (character_id, state)
           VALUES ($1, $2)
           ON CONFLICT (character_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`, [characterId, world]);
                await client.query(`INSERT INTO character_inventories (character_id, items)
           VALUES ($1, $2)
           ON CONFLICT (character_id) DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()`, [characterId, inventory]);
                const { rows } = await client.query(`SELECT c.id, c.account_id, c.profile, c.created_at, c.updated_at, c.last_selected_at,
                  COALESCE(w.state, '{}'::jsonb) AS world,
                  COALESCE(i.items, '[]'::jsonb) AS inventory
           FROM account_characters c
           LEFT JOIN character_world_states w ON w.character_id = c.id
           LEFT JOIN character_inventories i ON i.character_id = c.id
           WHERE c.id = $1`, [characterId]);
                await client.query('COMMIT');
                client.release();
                res.status(201).json(mapCharacter(rows[0]));
                return;
            }
            catch (error) {
                await client.query('ROLLBACK');
                client.release();
                if (error?.code === '23505' && !providedId) {
                    attempts += 1;
                    characterId = generateCharacterId();
                    continue;
                }
                next(error);
                return;
            }
        }
        res.status(500).json({ message: 'Unable to allocate character id' });
    }
    catch (error) {
        next(error);
    }
});
router.put('/:id', async (req, res, next) => {
    const characterId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!characterId) {
        res.status(400).json({ message: 'Invalid character id' });
        return;
    }
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId.trim() : '';
    try {
        const existing = await fetchCharacterRow(characterId);
        if (!existing) {
            res.status(404).json({ message: 'Character not found' });
            return;
        }
        if (accountId && accountId !== existing.account_id) {
            res.status(403).json({ message: 'Character does not belong to account' });
            return;
        }
        const { profile, inventory } = extractProfile(req.body?.profile);
        const world = sanitizeWorld(req.body?.world);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`UPDATE account_characters
         SET profile = $2,
             updated_at = NOW()
         WHERE id = $1`, [characterId, profile]);
            await client.query(`INSERT INTO character_world_states (character_id, state)
         VALUES ($1, $2)
         ON CONFLICT (character_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`, [characterId, world]);
            await client.query(`INSERT INTO character_inventories (character_id, items)
         VALUES ($1, $2)
         ON CONFLICT (character_id) DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()`, [characterId, inventory]);
            const { rows } = await client.query(`SELECT c.id, c.account_id, c.profile, c.created_at, c.updated_at, c.last_selected_at,
                COALESCE(w.state, '{}'::jsonb) AS world,
                COALESCE(i.items, '[]'::jsonb) AS inventory
         FROM account_characters c
         LEFT JOIN character_world_states w ON w.character_id = c.id
         LEFT JOIN character_inventories i ON i.character_id = c.id
         WHERE c.id = $1`, [characterId]);
            await client.query('COMMIT');
            res.json(mapCharacter(rows[0]));
        }
        catch (error) {
            await client.query('ROLLBACK');
            next(error);
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        next(error);
    }
});
export default router;
