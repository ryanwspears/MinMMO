import { Router } from 'express';
import { pool } from '../db.js';
const router = Router();
router.get('/', async (_req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM merchants ORDER BY name ASC');
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            res.status(400).json({ message: 'Invalid merchant id' });
            return;
        }
        const { rows } = await pool.query('SELECT * FROM merchants WHERE id = $1', [id]);
        if (rows.length === 0) {
            res.status(404).json({ message: 'Merchant not found' });
            return;
        }
        res.json(rows[0]);
    }
    catch (error) {
        next(error);
    }
});
router.post('/', async (req, res, next) => {
    const { name, inventory } = req.body ?? {};
    if (!name) {
        res.status(400).json({ message: 'name is required' });
        return;
    }
    try {
        const { rows } = await pool.query("INSERT INTO merchants (name, inventory) VALUES ($1, COALESCE($2, '[]'::jsonb)) RETURNING *", [name, inventory]);
        res.status(201).json(rows[0]);
    }
    catch (error) {
        next(error);
    }
});
router.put('/:id', async (req, res, next) => {
    const { name, inventory } = req.body ?? {};
    if (typeof name === 'undefined' && typeof inventory === 'undefined') {
        res.status(400).json({ message: 'At least one field (name or inventory) must be provided' });
        return;
    }
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            res.status(400).json({ message: 'Invalid merchant id' });
            return;
        }
        const { rows } = await pool.query(`UPDATE merchants
       SET name = COALESCE($2, name),
           inventory = COALESCE($3, inventory),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`, [id, name, inventory]);
        if (rows.length === 0) {
            res.status(404).json({ message: 'Merchant not found' });
            return;
        }
        res.json(rows[0]);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            res.status(400).json({ message: 'Invalid merchant id' });
            return;
        }
        const { rowCount } = await pool.query('DELETE FROM merchants WHERE id = $1', [id]);
        if (rowCount === 0) {
            res.status(404).json({ message: 'Merchant not found' });
            return;
        }
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
export default router;
