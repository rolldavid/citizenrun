import { sql } from 'drizzle-orm';
import { SeedError } from '../step.ts';
import type { SeedStep } from '../step.ts';

// The four extensions every migration after the first relies on (D-021).
const REQUIRED_EXTENSIONS = ['postgis', 'pg_trgm', 'citext', 'unaccent'] as const;

/** Asserts that the four extensions exist; inserts nothing. */
export const step: SeedStep = {
  name: '000-sanity',
  async run(tx) {
    const rows = await tx.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('postgis', 'pg_trgm', 'citext', 'unaccent')`,
      'objects',
    );
    const present = new Set(rows.map((row) => row.extname));
    const missing = REQUIRED_EXTENSIONS.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new SeedError(`Missing database extensions: ${missing.join(', ')}`);
    }
  },
};
