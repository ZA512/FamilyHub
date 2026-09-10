import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export * from './schema.js';

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'familyhub',
  });
}

export function createDatabase(pool: Pool) {
  return drizzle({ client: pool });
}

export type Database = ReturnType<typeof createDatabase>;
