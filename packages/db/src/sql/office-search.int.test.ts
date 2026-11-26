import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { getTestDb, insertOffice } from '../testing/index.ts';
import { refreshOfficeSearch } from './office-search.ts';

// L-office-search: the title at weight A, the jurisdiction, district and office type names at B.

async function matches(officeId: string, query: string): Promise<boolean | null> {
  const [row] = await getTestDb().execute<{ hit: boolean | null }>(
    sql`select search @@ to_tsquery('english', ${query}) as hit from offices where id = ${officeId}`,
    'objects',
  );
  return row?.hit ?? null;
}

describe('refreshOfficeSearch', () => {
  it('writes the three weighted parts', async () => {
    const [firstType] = await getTestDb().execute<{ id: string; name: string }>(
      sql`select id, name from office_types order by id limit 1`,
      'objects',
    );
    expect(firstType).toEqual({ id: 'attorney-general', name: 'State attorney general' });
    const office = await insertOffice(getTestDb(), { title: 'Fixture County Treasurer' });
    expect(await refreshOfficeSearch(getTestDb(), [office.id])).toBe(1);
    expect(await matches(office.id, 'treasurer:A')).toBe(true);
    expect(await matches(office.id, 'treasurer:B')).toBe(false);
    expect(await matches(office.id, 'attorney:B')).toBe(true);
    expect(await matches(office.id, 'attorney:A')).toBe(false);
  });

  it('sets updated_at', async () => {
    const office = await insertOffice(getTestDb(), {
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await refreshOfficeSearch(getTestDb(), [office.id]);
    const [row] = await getTestDb().execute<{ later: boolean }>(
      sql`select updated_at > '2026-01-01T00:00:00Z'::timestamptz as later from offices
          where id = ${office.id}`,
      'objects',
    );
    expect(row?.later).toBe(true);
  });

  it('leaves other offices untouched', async () => {
    const refreshed = await insertOffice(getTestDb());
    const other = await insertOffice(getTestDb());
    expect(await refreshOfficeSearch(getTestDb(), [refreshed.id])).toBe(1);
    const [row] = await getTestDb().execute<{ empty: boolean }>(
      sql`select search is null as empty from offices where id = ${other.id}`,
      'objects',
    );
    expect(row?.empty).toBe(true);
  });

  it('an empty list sends nothing', async () => {
    let sent = 0;
    const counting = {
      execute: (): never => {
        sent += 1;
        throw new Error('A statement was sent.');
      },
    } as unknown as Db;
    expect(await refreshOfficeSearch(counting, [])).toBe(0);
    expect(sent).toBe(0);
  });
});
