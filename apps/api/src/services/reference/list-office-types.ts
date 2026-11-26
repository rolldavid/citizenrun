import { officeTypes } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { OfficeTypeSchema } from '@citizenrun/shared';
import type { OfficeType } from '@citizenrun/shared';
import { asc } from 'drizzle-orm';

const OfficeTypeListSchema = OfficeTypeSchema.array();

/** Every office type in id order (E-REF-02); `aliases` is never read. */
export async function listOfficeTypes(db: Db): Promise<OfficeType[]> {
  // index: office_types_pkey
  const rows = await db
    .select({
      id: officeTypes.id,
      name: officeTypes.name,
      level: officeTypes.level,
      illustration: officeTypes.illustration,
      electorate: officeTypes.electorate,
    })
    .from(officeTypes)
    .orderBy(asc(officeTypes.id));
  // The table's checks hold `level` and `electorate` to the shape's values; the parse narrows them.
  return OfficeTypeListSchema.parse(rows);
}
