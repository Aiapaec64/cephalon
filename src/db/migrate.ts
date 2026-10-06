import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { validateDatabaseUrl } from '../config/env.js';
import { logError } from '../utils/logError.js';

config({ quiet: true });
let pool: Pool | undefined;
try {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('Missing required environment variable: DATABASE_URL');
  validateDatabaseUrl(url);
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
  const connection = await pool.connect();
  try {
    await connection.query('SELECT pg_advisory_lock(1128613960, 2)');
    await migrate(drizzle(connection), { migrationsFolder: fileURLToPath(new URL('../../migrations/', import.meta.url)) });
    console.log('Database migrations applied.');
  } finally {
    // Destroy the connection to release the session lock, even if migration failed.
    connection.release(true);
  }
} catch (error) {
  logError('Database migration failed. Check DATABASE_URL, connectivity, and migration files.', error);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
