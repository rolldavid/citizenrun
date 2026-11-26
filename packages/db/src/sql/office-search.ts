import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../client.ts';

/**
 * Rewrites offices.search for the given offices from title (A), jurisdiction and district names
 * (B) and office type name (B); sets updated_at. Returns the rows updated. An empty list sends no
 * statement. L-office-search (D-292, D-459): the text-search configuration is always 'english'.
 */
export async function refreshOfficeSearch(
  tx: Db | Tx,
  officeIds: readonly string[],
): Promise<number> {
  if (officeIds.length === 0) {
    return 0;
  }
  const updated = await tx.execute<{ id: string }>(
    sql`update offices o
        set search =
              setweight(to_tsvector('english', coalesce(o.title, '')), 'A')
           || setweight(to_tsvector('english', coalesce(j.name, '') || ' ' || coalesce(d.name, '')), 'B')
           || setweight(to_tsvector('english', coalesce(t.name, '')), 'B'),
            updated_at = now()
        from jurisdictions j, districts d, office_types t
        where j.id = o.jurisdiction_id
          and d.id = o.district_id
          and t.id = o.office_type_id
          and o.id = any(${sql.param(officeIds)}::uuid[])
        returning o.id`,
    'objects',
  );
  return updated.length;
}
