import { Pool } from 'pg';
const connectionString = process.env.DATABASE_URL;
const baseConfig = {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
};
if (connectionString) {
    baseConfig.connectionString = connectionString;
}
else {
    baseConfig.host = process.env.PGHOST ?? 'localhost';
    baseConfig.port = process.env.PGPORT ? Number(process.env.PGPORT) : 5432;
    baseConfig.database = process.env.PGDATABASE ?? 'minmmo';
    baseConfig.user = process.env.PGUSER ?? 'postgres';
    baseConfig.password = process.env.PGPASSWORD;
}
export const pool = new Pool(baseConfig);
export async function withClient(handler) {
    const client = await pool.connect();
    try {
        return await handler(client);
    }
    finally {
        client.release();
    }
}
export async function shutdownPool() {
    await pool.end();
}
