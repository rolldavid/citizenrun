import { follows } from '@citizenrun/db';
import { insertUser, makeFollow } from '@citizenrun/db/testing';
import { LIMITS } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { checkDailyLimit } from './daily-limits.ts';

// L-social-limits, the follows kind.
const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date('2027-03-05T18:00:00.000Z');

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

/** A user `ageDays` days old at NOW. */
async function follower(ageDays: number) {
  const createdAt = new Date(NOW.getTime() - ageDays * DAY_MS);
  const user = await insertUser(testApp.deps.db, { createdAt, onboardedAt: createdAt });
  return { userId: user.id, createdAt };
}

async function insertFollows(followerId: string, times: readonly Date[]): Promise<void> {
  const types = ['office', 'person', 'user'] as const;
  await testApp.deps.db
    .insert(follows)
    .values(
      times.map((createdAt, index) =>
        makeFollow({ followerId, targetType: types[index % types.length] ?? 'office', createdAt }),
      ),
    );
}

describe('checkDailyLimit', () => {
  it('counts every follow of the last 24 hours', async () => {
    const viewer = await follower(3);
    const limit = LIMITS.followsPerDay.newAccount;
    const times = Array.from(
      { length: limit },
      (_, index) => new Date(NOW.getTime() - (index + 1) * 60 * SECOND_MS),
    );
    await insertFollows(viewer.userId, times.slice(0, limit - 1));
    expect(await checkDailyLimit(testApp.deps.db, 'follows', viewer, NOW)).toEqual({ ok: true });
    await insertFollows(viewer.userId, times.slice(limit - 1));
    const oldest = times.at(-1) ?? NOW;
    expect(await checkDailyLimit(testApp.deps.db, 'follows', viewer, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: Math.ceil((oldest.getTime() + DAY_MS - NOW.getTime()) / SECOND_MS),
    });
  });

  it('a follow 24 hours and 1 second old is not counted', async () => {
    const viewer = await follower(3);
    const limit = LIMITS.followsPerDay.newAccount;
    const inside = Array.from(
      { length: limit - 1 },
      (_, index) => new Date(NOW.getTime() - (index + 1) * SECOND_MS),
    );
    await insertFollows(viewer.userId, [...inside, new Date(NOW.getTime() - DAY_MS - SECOND_MS)]);
    expect(await checkDailyLimit(testApp.deps.db, 'follows', viewer, NOW)).toEqual({ ok: true });
    // Exactly 24 hours old is outside the window too: only rows after now - 24h count.
    await insertFollows(viewer.userId, [new Date(NOW.getTime() - DAY_MS)]);
    expect(await checkDailyLimit(testApp.deps.db, 'follows', viewer, NOW)).toEqual({ ok: true });
  });

  it('Retry-After is at least one second', async () => {
    const viewer = await follower(3);
    const limit = LIMITS.followsPerDay.newAccount;
    // The oldest counted follow leaves the window in 200 ms.
    const oldest = new Date(NOW.getTime() - DAY_MS + 200);
    const rest = Array.from({ length: limit - 1 }, () => new Date(NOW.getTime() - HOUR_MS));
    await insertFollows(viewer.userId, [oldest, ...rest]);
    expect(await checkDailyLimit(testApp.deps.db, 'follows', viewer, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: 1,
    });
  });

  it('an established account has the higher limit', async () => {
    const viewer = await follower(7);
    const times = Array.from(
      { length: LIMITS.followsPerDay.newAccount },
      (_, index) => new Date(NOW.getTime() - (index + 1) * SECOND_MS),
    );
    await insertFollows(viewer.userId, times);
    expect(await checkDailyLimit(testApp.deps.db, 'follows', viewer, NOW)).toEqual({ ok: true });
  });
});
