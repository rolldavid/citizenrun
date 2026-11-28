import { FakeClock } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from './client.ts';
import { FLAG_CACHE_MS, createFlagReader } from './flags.ts';
import { getTestDb } from './testing/index.ts';

// A Db whose `execute` calls are counted; every other member is the test database's own.
function countingDb(db: Db): { db: Db; executes(): number } {
  let count = 0;
  const counted = new Proxy(db, {
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property === 'execute' && typeof value === 'function') {
        return (...args: unknown[]): unknown => {
          count += 1;
          return Reflect.apply(value, target, args);
        };
      }
      return value;
    },
  });
  return { db: counted, executes: () => count };
}

describe('createFlagReader', () => {
  it("reads a state's row", async () => {
    const flags = createFlagReader(getTestDb(), new FakeClock());
    expect(await flags.stateRule('TX')).toEqual({
      state: 'TX',
      signup: 'allow',
      ageMethod: 'store_signal_or_none',
      candidateTools: true,
    });
    expect(await flags.stateRule('XX')).toBeNull();
  });

  it('reads the earlier name of the default age method as the default', async () => {
    const db = getTestDb();
    await db.execute(
      sql`update state_rules set age_method = 'store_signal_or_dob' where state = 'TX'`,
    );
    const flags = createFlagReader(db, new FakeClock());
    expect((await flags.stateRule('TX'))?.ageMethod).toBe('store_signal_or_none');
    expect(await flags.stateRulesAtLaunchDefault()).toBe(true);
  });

  it('all rows at the launch default', async () => {
    const db = getTestDb();
    const clock = new FakeClock();
    const flags = createFlagReader(db, clock);
    expect(await flags.stateRulesAtLaunchDefault()).toBe(true);

    await db.execute(sql`update state_rules set signup = 'withhold' where state = 'MS'`);
    clock.advance(FLAG_CACHE_MS);
    expect(await flags.stateRulesAtLaunchDefault()).toBe(false);

    await db.execute(sql`update state_rules set signup = 'allow' where state = 'MS'`);
    await db.execute(
      sql`update state_rules set age_method = 'store_signal_required' where state = 'TN'`,
    );
    clock.advance(FLAG_CACHE_MS);
    expect(await flags.stateRulesAtLaunchDefault()).toBe(false);

    await db.execute(
      sql`update state_rules set age_method = 'store_signal_or_none' where state = 'TN'`,
    );
    await db.execute(sql`update state_rules set candidate_tools = false where state = 'CA'`);
    clock.advance(FLAG_CACHE_MS);
    expect(await flags.stateRulesAtLaunchDefault()).toBe(true);
    expect((await flags.stateRule('CA'))?.candidateTools).toBe(false);
  });

  it('cache', async () => {
    const db = getTestDb();
    const clock = new FakeClock();
    const flags = createFlagReader(db, clock);
    expect((await flags.stateRule('TX'))?.signup).toBe('allow');

    await db.execute(sql`update state_rules set signup = 'withhold' where state = 'TX'`);
    clock.advance(29_999);
    expect((await flags.stateRule('TX'))?.signup).toBe('allow');
    clock.advance(1);
    expect((await flags.stateRule('TX'))?.signup).toBe('withhold');
  });

  it('one load for concurrent readers', async () => {
    const counting = countingDb(getTestDb());
    const flags = createFlagReader(counting.db, new FakeClock());
    const answers = await Promise.all(Array.from({ length: 10 }, () => flags.stateRule('TX')));
    expect(counting.executes()).toBe(1);
    expect(answers.every((rule) => rule?.signup === 'allow')).toBe(true);
    // A read inside the window is answered from the cache.
    await flags.stateRulesAtLaunchDefault();
    expect(counting.executes()).toBe(1);
  });

  it('a failed load rejects its readers and the next call retries', async () => {
    const real = getTestDb();
    let failNext = true;
    const flaky = new Proxy(real, {
      get(target, property, receiver): unknown {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property === 'execute' && typeof value === 'function') {
          return (...args: unknown[]): unknown => {
            if (failNext) {
              failNext = false;
              return Promise.reject(new Error('fixture load failure'));
            }
            return Reflect.apply(value, target, args);
          };
        }
        return value;
      },
    });
    const clock = new FakeClock();
    const flags = createFlagReader(flaky, clock);
    const first = await Promise.allSettled([flags.stateRule('TX'), flags.stateRule('NY')]);
    expect(first.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect((await flags.stateRule('TX'))?.state).toBe('TX');

    // A failure after a good load keeps the old rules for the next successful read.
    await real.execute(sql`update state_rules set signup = 'withhold' where state = 'TX'`);
    clock.advance(FLAG_CACHE_MS);
    failNext = true;
    await expect(flags.stateRule('TX')).rejects.toThrow('fixture load failure');
    expect((await flags.stateRule('TX'))?.signup).toBe('withhold');
  });
});
