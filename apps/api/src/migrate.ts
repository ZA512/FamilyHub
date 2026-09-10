import { resolve } from 'node:path';

import { loadConfig } from '@familyhub/config';
import { createDatabase, createPool } from '@familyhub/database';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const database = createDatabase(pool);
const migrationsFolder = resolve(import.meta.dirname, '../../../packages/database/migrations');

try {
  await migrate(database, { migrationsFolder });
} finally {
  await pool.end();
}
