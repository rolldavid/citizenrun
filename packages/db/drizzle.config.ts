import { defineConfig } from 'drizzle-kit';

// No dbCredentials: no drizzle-kit command of this repository connects to a database. Migrations
// are applied by the runner (src/migrator.ts). The partitioned tables stay out of `schema` (D-237).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  extensionsFilters: ['postgis'],
});
