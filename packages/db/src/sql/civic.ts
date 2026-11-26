import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BuildAliasTable } from 'drizzle-orm/pg-core';
import type { elections, offices } from '../schema/civic.ts';
import type { districts, jurisdictions } from '../schema/geo.ts';
import type { people } from '../schema/people.ts';

// The query helpers of A4: a list of civic rows leaves retired rows out. Each is built from the
// columns of the table or alias it is given, so `alias(offices, 'o')` gets `"o"."retired_at"`.
// No helper filters `placeholder`. On this Drizzle line an alias has a type of its own, so each
// table type admits the table and its aliases.

export type JurisdictionsTable =
  typeof jurisdictions | BuildAliasTable<typeof jurisdictions, string>;
export type DistrictsTable = typeof districts | BuildAliasTable<typeof districts, string>;
export type OfficesTable = typeof offices | BuildAliasTable<typeof offices, string>;
export type ElectionsTable = typeof elections | BuildAliasTable<typeof elections, string>;
export type PeopleTable = typeof people | BuildAliasTable<typeof people, string>;

/** retired_at is null on the given jurisdictions table or alias. */
export function activeJurisdictions(j: JurisdictionsTable): SQL {
  return sql`${j.retiredAt} is null`;
}

/** retired_at is null on the given districts table or alias. */
export function activeDistricts(d: DistrictsTable): SQL {
  return sql`${d.retiredAt} is null`;
}

/** retired_at is null on the given offices table or alias. */
export function activeOffices(o: OfficesTable): SQL {
  return sql`${o.retiredAt} is null`;
}

/** retired_at is null on the given elections table or alias. */
export function activeElections(e: ElectionsTable): SQL {
  return sql`${e.retiredAt} is null`;
}

/** retired_at is null, merged_into is null and not roster_only (D-316). */
export function activePeople(p: PeopleTable): SQL {
  return sql`(${p.retiredAt} is null and ${p.mergedInto} is null and not ${p.rosterOnly})`;
}
