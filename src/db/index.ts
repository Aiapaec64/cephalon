import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { logError } from '../utils/logError.js';

let instance: ReturnType<typeof createDatabase> | undefined;

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, application_name: 'cephalon' });
  pool.on('error', (error) => logError('PostgreSQL pool error.', error));
  return { pool, db: drizzle(pool, { schema }) };
}

export function initializeDatabase(connectionString: string) {
  if (instance) throw new Error('Database already initialized.');
  instance = createDatabase(connectionString);
  return instance;
}

export function database() {
  if (!instance) throw new Error('Database is not initialized.');
  return instance;
}

export async function closeDatabase(): Promise<void> {
  if (instance) {
    await instance.pool.end();
    instance = undefined;
  }
}
