import type { Db } from '@citizenrun/db';
import { insertJurisdiction, insertOffice } from '@citizenrun/db/testing';
import { COVERED_STATES_CACHE_MS } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Deps } from '../../deps.ts';
import { createTestApp } from '../../testing/app.ts';
import { coveredStatesOf } from './covered-states.ts';

// The covered states, on factory rows of the fixture states ZZ and ZY.
const SECOND_STATE = 'ZY';

async function addRulesRow(db: Db, state: string): Promise<void> {
  await db.execute(sql`insert into state_rules (state) values (${state})`);
}

async function insertOfficeIn(db: Db, state: string, retiredAt: Date | null = null): Promise<void> {
  const jurisdiction = await insertJurisdiction(db, { state });
  await insertOffice(db, { jurisdictionId: jurisdiction.id, retiredAt });
}

describe('coveredStatesOf', () => {
  it('a state with a live office is covered and one with only retired offices is not', async () => {
    const testApp = await createTestApp();
    const { db, clock } = testApp.deps;
    await addRulesRow(db, SECOND_STATE);
    await insertOfficeIn(db, 'ZZ');
    await insertOfficeIn(db, SECOND_STATE, clock.now());
    const covered = await coveredStatesOf(testApp.deps).get(clock.now());
    expect([...covered]).toEqual(['ZZ']);
  });

  it('a state with offices but no rules row is not covered', async () => {
    const testApp = await createTestApp();
    const { db, clock } = testApp.deps;
    await insertOfficeIn(db, 'ZZ');
    await insertOfficeIn(db, SECOND_STATE);
    expect([...(await coveredStatesOf(testApp.deps).get(clock.now()))]).toEqual(['ZZ']);
  });

  it('the answer is cached for five minutes', async () => {
    const testApp = await createTestApp();
    const { db, clock } = testApp.deps;
    await addRulesRow(db, SECOND_STATE);
    await insertOfficeIn(db, 'ZZ');
    const reader = coveredStatesOf(testApp.deps);
    expect(coveredStatesOf(testApp.deps)).toBe(reader);
    expect([...(await reader.get(clock.now()))]).toEqual(['ZZ']);

    await insertOfficeIn(db, SECOND_STATE);
    clock.advance(COVERED_STATES_CACHE_MS - 1);
    expect([...(await reader.get(clock.now()))]).toEqual(['ZZ']);
    clock.advance(1);
    expect(COVERED_STATES_CACHE_MS).toBe(300_000);
    expect([...(await reader.get(clock.now()))].sort()).toEqual([SECOND_STATE, 'ZZ']);
  });

  it('concurrent callers share one load', async () => {
    const testApp = await createTestApp();
    const { db, clock } = testApp.deps;
    await insertOfficeIn(db, 'ZZ');
    const reader = coveredStatesOf(testApp.deps);
    testApp.resetStatementCount();
    const [first, second] = await Promise.all([reader.get(clock.now()), reader.get(clock.now())]);
    expect(first).toBe(second);
    expect(testApp.statementCount()).toBe(1);
  });

  it('a failed load rejects and the next call loads again', async () => {
    const testApp = await createTestApp();
    const { clock } = testApp.deps;
    await insertOfficeIn(testApp.deps.db, 'ZZ');
    const failing = new Proxy(
      {},
      {
        get() {
          return () => Promise.reject(new Error('The database is down.'));
        },
      },
    ) as Db; // a fake whose every call rejects
    const deps: Deps = { ...testApp.deps, db: failing };
    const reader = coveredStatesOf(deps);
    await expect(reader.get(clock.now())).rejects.toThrow('The database is down.');
    deps.db = testApp.deps.db;
    expect([...(await reader.get(clock.now()))]).toEqual(['ZZ']);
  });
});
