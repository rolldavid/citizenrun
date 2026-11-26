import { people } from '@citizenrun/db';
import {
  getTestDb,
  insertCandidacy,
  insertElection,
  insertJurisdiction,
  insertOffice,
  insertOfficeholder,
  insertPerson,
} from '@citizenrun/db/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_MERGE_HOPS } from '../civic/person-summary.ts';
import { resolvePerson, toolsStateOf } from './resolve-person.ts';

// L-person-resolve on factory rows of the fixture states.

beforeEach(async () => {
  await getTestDb().execute(
    sql`insert into state_rules (state) values ('ZX'), ('ZY') on conflict do nothing`,
  );
});

/** A chain of `hops` merges ending at a survivor: returns the first id and the survivor's. */
async function mergeChain(hops: number): Promise<{ first: string; survivor: string }> {
  const db = getTestDb();
  const survivor = await insertPerson(db);
  let next = survivor.id;
  for (let n = 0; n < hops; n += 1) {
    next = (await insertPerson(db, { mergedInto: next })).id;
  }
  return { first: next, survivor: survivor.id };
}

/** An office in a new jurisdiction of `state`. */
async function officeIn(state: string) {
  const jurisdiction = await insertJurisdiction(getTestDb(), { state });
  return insertOffice(getTestDb(), { jurisdictionId: jurisdiction.id });
}

describe('resolvePerson', () => {
  it('rule 1: a uuid by id, a slug by slug, anything else by nothing', async () => {
    const db = getTestDb();
    const person = await insertPerson(db);
    expect(await resolvePerson(db, person.id)).toEqual({ id: person.id });
    expect(await resolvePerson(db, person.id.toUpperCase())).toEqual({ id: person.id });
    expect(await resolvePerson(db, person.slug)).toEqual({ id: person.id });
    expect(await resolvePerson(db, '00000000-0000-7000-8000-00000000ffff')).toBeNull();
    expect(await resolvePerson(db, 'fixture-nobody')).toBeNull();
    for (const malformed of [
      person.slug.toUpperCase(),
      'two words',
      '-lead',
      'a--b',
      'a'.repeat(121),
    ]) {
      expect(await resolvePerson(db, malformed), malformed).toBeNull();
    }
  });

  it('rule 2: merges are followed five hops at most, and never round a cycle', async () => {
    const db = getTestDb();
    const five = await mergeChain(MAX_MERGE_HOPS);
    expect(await resolvePerson(db, five.first)).toEqual({ id: five.survivor });
    const six = await mergeChain(MAX_MERGE_HOPS + 1);
    expect(await resolvePerson(db, six.first)).toBeNull();
    const a = await insertPerson(db);
    const b = await insertPerson(db, { mergedInto: a.id });
    await db.update(people).set({ mergedInto: b.id }).where(eq(people.id, a.id));
    expect(await resolvePerson(db, a.slug)).toBeNull();
    expect(await resolvePerson(db, b.id)).toBeNull();
  });

  it('rule 3: a roster-only person does not resolve', async () => {
    const db = getTestDb();
    const director = await insertPerson(db, { rosterOnly: true });
    expect(await resolvePerson(db, director.id)).toBeNull();
    expect(await resolvePerson(db, director.slug)).toBeNull();
    const merged = await insertPerson(db, { mergedInto: director.id });
    expect(await resolvePerson(db, merged.id)).toBeNull();
    // A retired person still resolves (R-018).
    const retired = await insertPerson(db, { retiredAt: new Date('2027-01-01T00:00:00.000Z') });
    expect(await resolvePerson(db, retired.slug)).toEqual({ id: retired.id });
  });

  it("rule 4: the tools state is the state of one of the person's offices", async () => {
    const db = getTestDb();
    const person = await insertPerson(db);
    const office = await officeIn('ZX');
    await insertOfficeholder(db, { personId: person.id, officeId: office.id });
    expect(await toolsStateOf(db, person.id)).toBe('ZX');
  });

  it('the tools state prefers the latest candidacy, then a current seat', async () => {
    const db = getTestDb();
    const person = await insertPerson(db);
    const seat = await officeIn('ZZ');
    const earlier = await officeIn('ZX');
    const later = await officeIn('ZY');
    await insertOfficeholder(db, { personId: person.id, officeId: seat.id, since: '2020-01-01' });
    // A seat that ended does not count.
    const ended = await officeIn('ZX');
    await insertOfficeholder(db, {
      personId: person.id,
      officeId: ended.id,
      since: '2010-01-01',
      until: '2014-01-01',
    });
    expect(await toolsStateOf(db, person.id)).toBe('ZZ');
    const first = await insertElection(db, { officeId: earlier.id, electionDate: '2027-11-02' });
    const second = await insertElection(db, { officeId: later.id, electionDate: '2028-11-07' });
    await insertCandidacy(db, { personId: person.id, electionId: first.id });
    expect(await toolsStateOf(db, person.id)).toBe('ZX');
    await insertCandidacy(db, { personId: person.id, electionId: second.id });
    expect(await toolsStateOf(db, person.id)).toBe('ZY');

    // Of two current seats, the earlier `since` wins.
    const holder = await insertPerson(db);
    const older = await officeIn('ZY');
    const newer = await officeIn('ZX');
    await insertOfficeholder(db, { personId: holder.id, officeId: newer.id, since: '2022-01-01' });
    await insertOfficeholder(db, { personId: holder.id, officeId: older.id, since: '2018-01-01' });
    expect(await toolsStateOf(db, holder.id)).toBe('ZY');
  });

  it('no candidacy and no seat gives no tools state', async () => {
    const db = getTestDb();
    const person = await insertPerson(db);
    expect(await toolsStateOf(db, person.id)).toBeNull();
    const past = await officeIn('ZX');
    await insertOfficeholder(db, {
      personId: person.id,
      officeId: past.id,
      since: '2010-01-01',
      until: '2012-01-01',
    });
    expect(await toolsStateOf(db, person.id)).toBeNull();
  });
});
