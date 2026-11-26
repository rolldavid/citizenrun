import { nameKey } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getTestDb } from './testing/index.ts';

/**
 * The thirty names of L-name-key-mirror, in order; the shared package's unit test holds the same
 * constant. A divergence is fixed in nameKey, never in the expected key.
 */
const NAME_KEY_FIXTURES: readonly (readonly [string | null, string | null, string | null])[] = [
  ['JOHN', 'SMITH', 'john smith'],
  ['Mary', 'Kopechne', 'mary kopechne'],
  ['Maria', 'Garcia Lopez', 'maria garcia lopez'],
  ['Robert', 'Smith', 'robert smith'],
  ['Katherine', "O'Brien", 'katherine obrien'],
  ['Juan', 'de la Cruz', 'juan de la cruz'],
  ['Jane', 'Doe', 'jane doe'],
  [null, 'Cher', 'cher'],
  ['Mary', 'V', 'mary v'],
  ['Ann', 'Lee', 'ann lee'],
  ['Anne', 'Lee', 'anne lee'],
  ['James', 'Miller', 'james miller'],
  ['James', 'Milner', 'james milner'],
  ['Jon', 'Smith', 'jon smith'],
  ['Joan', 'Smith', 'joan smith'],
  ['William', 'Johnson', 'william johnson'],
  ['Bill', 'Johnson', 'bill johnson'],
  ['Bob', 'Smith', 'bob smith'],
  ['José', "O'Brien-García", 'jose obriengarcia'],
  ['Zoë', 'Saldaña', 'zoe saldana'],
  ['François', 'Côté', 'francois cote'],
  ['Renée', 'Fleming-Núñez', 'renee flemingnunez'],
  ['Björn', 'Ångström', 'bjorn angstrom'],
  ['Łukasz', 'Wróbel', 'lukasz wrobel'],
  ['Søren', 'Kierkegaard', 'soren kierkegaard'],
  ['Hans', 'Groß', 'hans gross'],
  ['Mary-Kate', 'Olsen', 'marykate olsen'],
  ['  Ana  ', ' María ', 'ana maria'],
  [null, null, null],
  ['', '', null],
];

describe('os_name_key', () => {
  it('the mirror equals the database on thirty names', async () => {
    expect(NAME_KEY_FIXTURES).toHaveLength(30);
    const db = getTestDb();
    for (const [first, last, expected] of NAME_KEY_FIXTURES) {
      const rows = await db.execute<{ key: string | null }>(
        sql`select os_name_key(${first}::text, ${last}::text) as key`,
        'objects',
      );
      const stored = rows[0]?.key ?? null;
      expect({ first, last, key: stored }).toEqual({ first, last, key: expected });
      expect({ first, last, key: nameKey(first, last) }).toEqual({ first, last, key: expected });
    }
  });
});
