import type { Db } from '@citizenrun/db';
import { GEO_SUGGESTIONS_MAX, roundHalfAwayFromZero } from '@citizenrun/shared';
import type { GeoSuggestion } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';

const ZIP_QUERY = /^[0-9]{3,5}$/;
const ZIP_LENGTH = 5;
const COORDINATE_DECIMALS = 6; // GeoSuggestion

type ZipRow = { zip: string; state: string; lat: number; lng: number };
type PlaceRow = {
  id: string;
  name: string;
  state: string;
  kind: 'city' | 'county' | 'township';
  lat: number;
  lng: number;
};

function rounded(value: number): number {
  return roundHalfAwayFromZero(value, COORDINATE_DECIMALS);
}

/** The text with `\`, `%` and `_` escaped for LIKE, so each matches itself. */
function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
}

async function searchZips(db: Db, q: string, covered: readonly string[]): Promise<GeoSuggestion[]> {
  // Every five-digit code that starts with `q`, as `zip like q || '%'`, read through the key.
  const lo = q.padEnd(ZIP_LENGTH, '0');
  const hi = q.padEnd(ZIP_LENGTH, '9');
  // index: zip_centroids_pkey
  const rows = await db.execute<ZipRow>(
    sql`select zip, state, st_y(point) as lat, st_x(point) as lng
        from zip_centroids
        where zip between ${lo} and ${hi}
          and state = any(${sql.param(covered)}::text[])
        order by zip
        limit ${GEO_SUGGESTIONS_MAX}`,
    'objects',
  );
  return rows.map((row) => ({
    label: `${row.zip}, ${row.state}`,
    lat: rounded(row.lat),
    lng: rounded(row.lng),
    precision: 'approx',
    kind: 'zip',
  }));
}

async function searchNames(
  db: Db,
  q: string,
  covered: readonly string[],
): Promise<GeoSuggestion[]> {
  const prefix = `${escapeLike(q)}%`;
  // index: jurisdictions_name_trgm
  const rows = await db.execute<PlaceRow>(
    sql`select j.id, j.name, j.state, j.kind, st_y(j.label_point) as lat, st_x(j.label_point) as lng
        from jurisdictions j
        where j.retired_at is null
          and j.label_point is not null
          and j.kind in ('city', 'county', 'township')
          and j.state = any(${sql.param(covered)}::text[])
          and (j.name ilike ${prefix} or j.name % ${q})
        order by (j.name ilike ${prefix}) desc, similarity(j.name, ${q}) desc,
                 j.population desc nulls last, j.id
        limit ${GEO_SUGGESTIONS_MAX}`,
    'objects',
  );
  return rows.map((row) => ({
    label: `${row.name}, ${row.state}`,
    lat: rounded(row.lat),
    lng: rounded(row.lng),
    precision: 'approx',
    kind: row.kind,
  }));
}

/**
 * L-place-search: places in the covered states from our own tables, with no outbound call (D-057,
 * D-212). A query of three to five digits reads the ZIP centroids; any other query reads cities,
 * counties and townships by prefix, then by trigram similarity.
 */
export async function searchPlaces(
  db: Db,
  input: { q: string; covered: ReadonlySet<string> },
): Promise<GeoSuggestion[]> {
  if (input.covered.size === 0) {
    return [];
  }
  const q = input.q.trim();
  const covered = [...input.covered].sort();
  return ZIP_QUERY.test(q) ? searchZips(db, q, covered) : searchNames(db, q, covered);
}
