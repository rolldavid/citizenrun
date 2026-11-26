import { jurisdictions, offices } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** An office as the office routes resolve it: a retired one resolves too. */
export type ResolvedOffice = { id: string; retiredAt: Date | null; timezone: string | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The slug rule of offices_slug_check.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 120;

async function readOffice(db: Db | Tx, where: SQL): Promise<ResolvedOffice | null> {
  const [row] = await db
    .select({ id: offices.id, retiredAt: offices.retiredAt, timezone: jurisdictions.timezone })
    .from(offices)
    .innerJoin(jurisdictions, eq(jurisdictions.id, offices.jurisdictionId))
    .where(where);
  return row ?? null;
}

/** The office a path names by primary key; null when there is none. */
export function resolveOfficeById(db: Db | Tx, id: string): Promise<ResolvedOffice | null> {
  // index: offices_pkey
  return readOffice(db, eq(offices.id, id));
}

/**
 * The office a path names by id or slug: a uuid is read by primary key, a well-formed slug by
 * offices_slug_key; anything else is null without a statement.
 */
export function resolveOffice(db: Db | Tx, idOrSlug: string): Promise<ResolvedOffice | null> {
  if (UUID_PATTERN.test(idOrSlug)) {
    return resolveOfficeById(db, idOrSlug.toLowerCase());
  }
  if (idOrSlug.length > SLUG_MAX || !SLUG_PATTERN.test(idOrSlug)) {
    return Promise.resolve(null);
  }
  // index: offices_slug_key
  return readOffice(db, eq(offices.slug, idOrSlug));
}
