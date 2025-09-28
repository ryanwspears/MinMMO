import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withClient, shutdownPool } from '../db.js';
async function ensureMigrationsTable() {
    await withClient(async (client) => {
        await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    });
}
async function runMigrations() {
    const migrationsDir = join(process.cwd(), 'server', 'migrations');
    const files = (await readdir(migrationsDir))
        .filter(file => file.endsWith('.sql'))
        .sort();
    await ensureMigrationsTable();
    for (const file of files) {
        const migrationId = file;
        await withClient(async (client) => {
            const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migrationId]);
            if ((rowCount ?? 0) > 0) {
                return;
            }
            const sql = await readFile(join(migrationsDir, file), 'utf-8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migrationId]);
                await client.query('COMMIT');
                console.log(`Applied migration ${migrationId}`);
            }
            catch (error) {
                await client.query('ROLLBACK');
                console.error(`Failed to apply migration ${migrationId}`);
                throw error;
            }
        });
    }
}
runMigrations()
    .catch(error => {
    console.error(error);
    process.exitCode = 1;
})
    .finally(async () => {
    await shutdownPool();
});
