import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { getTestDb, insertElection, insertFilingTrack } from '../testing/index.ts';
import type { FilingTrackOverrides } from '../testing/index.ts';
import { recomputeHeadlineDeadlines } from './headline-deadline.ts';

// TEST-headline-deadline: L-headline-deadline on real PostgreSQL. Every election is dated
// 2027-06-01, so every track date below is before it; each track of one election is a different
// `track`, because filing_tracks_track_key allows one per election.

type Headline = {
  filing_opens: string | null;
  filing_deadline: string | null;
  filing_deadline_time: string | null;
  petition_due: string | null;
  deadline_basis: string | null;
};

async function headline(electionId: string): Promise<Headline | undefined> {
  const [row] = await getTestDb().execute<Headline>(
    sql`select filing_opens::text as filing_opens, filing_deadline::text as filing_deadline,
               filing_deadline_time::text as filing_deadline_time,
               petition_due::text as petition_due, deadline_basis
        from elections where id = ${electionId}`,
    'objects',
  );
  return row;
}

async function electionWith(tracks: readonly FilingTrackOverrides[]): Promise<string> {
  const election = await insertElection(getTestDb(), { electionDate: '2027-06-01' });
  for (const track of tracks) {
    await insertFilingTrack(getTestDb(), {
      opensOn: '2027-01-04',
      ...track,
      electionId: election.id,
    });
  }
  return election.id;
}

describe('L-headline-deadline', () => {
  it('earliest closing date wins', async () => {
    const id = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', closesTime: '12:00' },
      { track: 'independent', closesOn: '2027-05-01', closesTime: null },
    ]);
    expect(await headline(id)).toMatchObject({
      filing_deadline: '2027-03-05',
      filing_deadline_time: '12:00:00',
    });
  });

  it('tie takes the earliest known time', async () => {
    const id = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', closesTime: '17:00' },
      { track: 'independent', closesOn: '2027-03-05', closesTime: '12:00' },
    ]);
    expect(await headline(id)).toMatchObject({
      filing_deadline: '2027-03-05',
      filing_deadline_time: '12:00:00',
    });
  });

  it('tie with one unknown time', async () => {
    const id = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', closesTime: null },
      { track: 'independent', closesOn: '2027-03-05', closesTime: '17:00' },
    ]);
    expect(await headline(id)).toMatchObject({
      filing_deadline: '2027-03-05',
      filing_deadline_time: '17:00:00',
    });
  });

  it('no sourced time', async () => {
    const id = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', closesTime: null },
      { track: 'independent', closesOn: '2027-03-05', closesTime: null },
    ]);
    expect(await headline(id)).toMatchObject({
      filing_deadline: '2027-03-05',
      filing_deadline_time: null,
    });
  });

  it('no hour is invented', async () => {
    const election = await insertElection(getTestDb(), { electionDate: '2027-06-01' });
    const track = await insertFilingTrack(getTestDb(), {
      electionId: election.id,
      track: 'nonpartisan',
      opensOn: '2027-02-01',
      closesOn: '2027-03-05',
    });
    expect(track.closesTime).toBeNull();
    expect(await headline(election.id)).toMatchObject({
      filing_deadline: '2027-03-05',
      filing_deadline_time: null,
    });
  });

  it('opening date from the headline tracks', async () => {
    const id = await electionWith([
      { track: 'party_primary', opensOn: '2027-02-19', closesOn: '2027-03-05' },
      { track: 'independent', opensOn: '2027-02-12', closesOn: '2027-03-05' },
      { track: 'write_in', opensOn: '2027-01-10', closesOn: '2027-04-01' },
    ]);
    expect(await headline(id)).toMatchObject({
      filing_opens: '2027-02-12',
      filing_deadline: '2027-03-05',
    });
  });

  it('opening date of any track when no track has a closing date', async () => {
    const id = await electionWith([
      { track: 'party_primary', opensOn: '2027-02-19', closesOn: null },
      { track: 'independent', opensOn: '2027-02-12', closesOn: null },
    ]);
    expect(await headline(id)).toEqual({
      filing_opens: '2027-02-12',
      filing_deadline: null,
      filing_deadline_time: null,
      petition_due: null,
      deadline_basis: null,
    });
  });

  it('basis of the headline tracks', async () => {
    const mixed = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', basis: 'computed' },
      { track: 'independent', closesOn: '2027-03-05', basis: 'both' },
      { track: 'write_in', closesOn: '2027-04-01', basis: 'scraped' },
    ]);
    expect((await headline(mixed))?.deadline_basis).toBe('both');
    const scraped = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', basis: 'computed' },
      { track: 'independent', closesOn: '2027-03-05', basis: 'scraped' },
    ]);
    expect((await headline(scraped))?.deadline_basis).toBe('scraped');
    const computed = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', basis: 'computed' },
    ]);
    expect((await headline(computed))?.deadline_basis).toBe('computed');
  });

  it('petition due is the earliest of any track', async () => {
    const id = await electionWith([
      { track: 'party_primary', closesOn: '2027-03-05', petitionDue: '2027-02-20' },
      { track: 'independent', closesOn: '2027-05-01', petitionDue: '2027-02-10' },
      { track: 'write_in', closesOn: '2027-05-01', petitionDue: null },
    ]);
    expect((await headline(id))?.petition_due).toBe('2027-02-10');
  });

  it('no tracks clears the headline', async () => {
    const id = await electionWith([
      {
        track: 'party_primary',
        opensOn: '2027-02-01',
        closesOn: '2027-03-05',
        closesTime: '12:00',
        petitionDue: '2027-02-20',
      },
    ]);
    expect((await headline(id))?.filing_deadline).toBe('2027-03-05');
    await getTestDb().execute(sql`delete from filing_tracks where election_id = ${id}`);
    expect(await recomputeHeadlineDeadlines(getTestDb(), [id])).toBe(1);
    expect(await headline(id)).toEqual({
      filing_opens: null,
      filing_deadline: null,
      filing_deadline_time: null,
      petition_due: null,
      deadline_basis: null,
    });
  });

  it('only the given elections change', async () => {
    const first = await electionWith([{ track: 'party_primary', closesOn: '2027-03-05' }]);
    const second = await electionWith([{ track: 'party_primary', closesOn: '2027-03-05' }]);
    const before = await headline(second);
    await getTestDb().execute(
      sql`delete from filing_tracks where election_id in (${first}, ${second})`,
    );
    expect(await recomputeHeadlineDeadlines(getTestDb(), [first])).toBe(1);
    expect((await headline(first))?.filing_deadline).toBeNull();
    expect(await headline(second)).toEqual(before);
  });

  it('an empty list returns 0 and sends nothing', async () => {
    let sent = 0;
    const counting = {
      execute: (): never => {
        sent += 1;
        throw new Error('A statement was sent.');
      },
    } as unknown as Db;
    expect(await recomputeHeadlineDeadlines(counting, [])).toBe(0);
    expect(sent).toBe(0);
  });
});
