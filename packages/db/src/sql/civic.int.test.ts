import { and, count, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { elections, offices } from '../schema/civic.ts';
import { districts, jurisdictions } from '../schema/geo.ts';
import { people } from '../schema/people.ts';
import {
  getTestDb,
  insertDistrict,
  insertElection,
  insertJurisdiction,
  insertOffice,
  insertPerson,
} from '../testing/index.ts';
import {
  activeDistricts,
  activeElections,
  activeJurisdictions,
  activeOffices,
  activePeople,
} from './civic.ts';

const RETIRED = new Date('2026-01-01T00:00:00.000Z');

describe('the active helpers', () => {
  it('active helpers leave retired rows out', async () => {
    const db = getTestDb();
    const pairs = {
      jurisdictions: [
        (await insertJurisdiction(db)).id,
        (await insertJurisdiction(db, { retiredAt: RETIRED })).id,
      ],
      districts: [
        (await insertDistrict(db)).id,
        (await insertDistrict(db, { retiredAt: RETIRED })).id,
      ],
      offices: [(await insertOffice(db)).id, (await insertOffice(db, { retiredAt: RETIRED })).id],
      elections: [
        (await insertElection(db)).id,
        (await insertElection(db, { retiredAt: RETIRED })).id,
      ],
      people: [(await insertPerson(db)).id, (await insertPerson(db, { retiredAt: RETIRED })).id],
    };
    const live = async (query: Promise<{ id: string }[]>): Promise<string[]> =>
      (await query).map((row) => row.id);
    expect(
      await live(
        db
          .select({ id: jurisdictions.id })
          .from(jurisdictions)
          .where(
            and(inArray(jurisdictions.id, pairs.jurisdictions), activeJurisdictions(jurisdictions)),
          ),
      ),
    ).toEqual([pairs.jurisdictions[0]]);
    expect(
      await live(
        db
          .select({ id: districts.id })
          .from(districts)
          .where(and(inArray(districts.id, pairs.districts), activeDistricts(districts))),
      ),
    ).toEqual([pairs.districts[0]]);
    expect(
      await live(
        db
          .select({ id: offices.id })
          .from(offices)
          .where(and(inArray(offices.id, pairs.offices), activeOffices(offices))),
      ),
    ).toEqual([pairs.offices[0]]);
    expect(
      await live(
        db
          .select({ id: elections.id })
          .from(elections)
          .where(and(inArray(elections.id, pairs.elections), activeElections(elections))),
      ),
    ).toEqual([pairs.elections[0]]);
    expect(
      await live(
        db
          .select({ id: people.id })
          .from(people)
          .where(and(inArray(people.id, pairs.people), activePeople(people))),
      ),
    ).toEqual([pairs.people[0]]);
  });

  it('activePeople leaves merged and roster-only people out', async () => {
    const db = getTestDb();
    const kept = await insertPerson(db);
    const merged = await insertPerson(db, { mergedInto: kept.id });
    const rosterOnly = await insertPerson(db, { rosterOnly: true });
    const [found] = await db
      .select({ n: count() })
      .from(people)
      .where(and(inArray(people.id, [kept.id, merged.id, rosterOnly.id]), activePeople(people)));
    expect(found?.n).toBe(1);
    const [only] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(inArray(people.id, [kept.id, merged.id, rosterOnly.id]), activePeople(people)));
    expect(only?.id).toBe(kept.id);
  });

  it('helpers respect an alias', async () => {
    const db = getTestDb();
    const live = await insertOffice(db);
    const retired = await insertOffice(db, { retiredAt: RETIRED });
    const o = alias(offices, 'o');
    const query = db
      .select({ id: o.id })
      .from(o)
      .where(and(inArray(o.id, [live.id, retired.id]), activeOffices(o)));
    expect(query.toSQL().sql).toContain('"o"."retired_at" is null');
    expect((await query).map((row) => row.id)).toEqual([live.id]);
  });
});
