import {
  fixtureVersion,
  getTestDb,
  insertOffice,
  insertOfficePower,
  loadFixture,
  resetStorage,
  setOfficeIssues,
  zzBundle,
  zzGeometry,
} from '@citizenrun/db/testing';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { withCivicLock } from '../../lib/civic-lock.ts';
import { peekQueue, runJob, runQueued } from '../../testing/job.ts';
import { RetryableJobError } from '../types.ts';
import { rebuildAllOfficeIssues, scoreIssues } from './issues.ts';

// TEST-score-issues.

type IssueRow = { office_id: string; issue_id: string; relevance: number };

async function issuesOf(officeId: string): Promise<IssueRow[]> {
  return getTestDb().execute<IssueRow>(
    sql`select office_id, issue_id, relevance from office_issues
        where office_id = ${officeId}::uuid order by issue_id`,
    'objects',
  );
}

/** The issues `power` moves, from the reference rows. */
async function issuesMovedBy(power: string): Promise<string[]> {
  const rows = await getTestDb().execute<{ issue_id: string }>(
    sql`select issue_id from issue_powers where power_id = ${power} order by issue_id`,
    'objects',
  );
  return rows.map((row) => row.issue_id);
}

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-score.issues', () => {
  it("the highest relevance among an issue's powers", async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    // Both powers move rent-housing; zoning also moves issues rent rules do not.
    await insertOfficePower(db, { officeId: office.id, powerId: 'zoning-land-use', relevance: 2 });
    await insertOfficePower(db, {
      officeId: office.id,
      powerId: 'rent-tenant-rules',
      relevance: 3,
    });
    const result = await runJob(scoreIssues, { scope: 'offices', officeIds: [office.id] });
    expect(result.outcome).toBe('completed');
    const rows = await issuesOf(office.id);
    expect(rows.filter((row) => row.issue_id === 'rent-housing')).toEqual([
      { office_id: office.id, issue_id: 'rent-housing', relevance: 3 },
    ]);
    const zoningOnly = (await issuesMovedBy('zoning-land-use')).filter(
      (issue) => issue !== 'rent-housing',
    );
    expect(zoningOnly.length).toBeGreaterThan(0);
    for (const issue of zoningOnly) {
      expect(rows.find((row) => row.issue_id === issue)?.relevance, issue).toBe(2);
    }
    const expected = new Set([
      ...(await issuesMovedBy('zoning-land-use')),
      ...(await issuesMovedBy('rent-tenant-rules')),
    ]);
    expect(rows.map((row) => row.issue_id)).toEqual([...expected].sort());
  });

  it('an office with no powers has no rows', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    await setOfficeIssues(db, office.id, [{ issueId: 'climate', relevance: 2 }]);
    const result = await runJob(scoreIssues, { scope: 'offices', officeIds: [office.id] });
    expect(result.outcome).toBe('completed');
    expect(await issuesOf(office.id)).toEqual([]);
  });

  it('is idempotent', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    await insertOfficePower(db, { officeId: office.id, powerId: 'utility-rates', relevance: 3 });
    await runJob(scoreIssues, { scope: 'offices', officeIds: [office.id] });
    const first = await issuesOf(office.id);
    expect(first.length).toBeGreaterThan(0);
    await runJob(scoreIssues, { scope: 'all' });
    await runJob(scoreIssues, { scope: 'offices', officeIds: [office.id] });
    expect(await issuesOf(office.id)).toEqual(first);
  });

  it('all walks every live office in chunks', async () => {
    const db = getTestDb();
    const live: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const office = await insertOffice(db);
      await insertOfficePower(db, { officeId: office.id, powerId: 'utility-rates', relevance: 2 });
      live.push(office.id);
    }
    const retired = await insertOffice(db, { retiredAt: new Date('2027-01-01T00:00:00Z') });
    await insertOfficePower(db, { officeId: retired.id, powerId: 'utility-rates', relevance: 3 });
    await setOfficeIssues(db, retired.id, [{ issueId: 'climate', relevance: 1 }]);
    let touches = 0;
    const walked = await rebuildAllOfficeIssues(db, {
      chunkSize: 2,
      signal: neverAborted(),
      touch: () => {
        touches += 1;
        return Promise.resolve();
      },
    });
    expect(walked).toEqual({ offices: 5, chunks: 3 });
    expect(touches).toBe(3);
    const moved = await issuesMovedBy('utility-rates');
    for (const id of live) {
      expect((await issuesOf(id)).map((row) => [row.issue_id, row.relevance])).toEqual(
        moved.map((issue) => [issue, 2]),
      );
    }
    expect(await issuesOf(retired.id)).toEqual([
      { office_id: retired.id, issue_id: 'climate', relevance: 1 },
    ]);
  });

  it('a load that changes office_powers enqueues it', async () => {
    const db = getTestDb();
    await loadFixture(
      db,
      {
        version: fixtureVersion('2027-01-15T06:00:00Z', 'full'),
        files: zzBundle({ today: '2027-01-15' }),
        geometry: zzGeometry(),
      },
      { now: new Date('2027-01-15T06:00:00Z') },
    );
    expect(await peekQueue('score.issues')).toHaveLength(1);
    const ran = await runQueued({ queues: ['score.issues'] });
    expect(ran.map((job) => job.outcome)).toEqual(['completed']);
    const offices = await db.execute<{ id: string }>(sql`select id from offices`, 'objects');
    expect(offices).toHaveLength(20);
    const moved = await issuesMovedBy('zoning-land-use');
    for (const office of offices) {
      expect((await issuesOf(office.id)).map((row) => [row.issue_id, row.relevance])).toEqual(
        moved.map((issue) => [issue, 3]),
      );
    }
  });

  it('stops at shutdown', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    await setOfficeIssues(db, office.id, [{ issueId: 'climate', relevance: 1 }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      rebuildAllOfficeIssues(db, {
        chunkSize: 2,
        signal: controller.signal,
        touch: () => Promise.resolve(),
      }),
    ).rejects.toBeInstanceOf(RetryableJobError);
    const job = await runJob(scoreIssues, { scope: 'all' }, { signal: controller.signal });
    expect(job.outcome).toBe('failed');
    expect(job.error).toBeInstanceOf(RetryableJobError);
    expect(await issuesOf(office.id)).toEqual([
      { office_id: office.id, issue_id: 'climate', relevance: 1 },
    ]);
  });

  it('a busy civic lock re-sends the job', async () => {
    const db = getTestDb();
    const office = await insertOffice(db);
    const payload = { scope: 'offices' as const, officeIds: [office.id] };
    const held = await withCivicLock(db, () => runJob(scoreIssues, payload));
    expect(held.ran).toBe(true);
    if (held.ran) {
      expect(held.value.outcome).toBe('completed');
    }
    const jobs = await peekQueue('score.issues');
    expect(jobs.map((job) => [job.data, job.singletonKey])).toEqual([[payload, null]]);
    expect(jobs[0]?.startAfter.getTime() ?? 0).toBeGreaterThan(Date.now() + 100_000);
  });
});
