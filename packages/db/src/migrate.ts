import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { requireConnectionString } from './env.js';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const client = postgres(requireConnectionString(), { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder });
  console.log('[migrate] migrations applied.');
} finally {
  await client.end();
}
