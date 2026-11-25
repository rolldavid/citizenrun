import { rateLimits } from '@citizenrun/db';
import { getTestDb, insertUser } from '@citizenrun/db/testing';
import { describe, expect, it } from 'vitest';
import { countUserEmail } from './email-cap.ts';

describe('the per-user email cap', () => {
  it('counts per user and UTC day', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    const other = await insertUser(db);

    expect(await countUserEmail(db, user.id, new Date('2027-03-05T00:00:00.000Z'))).toBe(1);
    expect(await countUserEmail(db, user.id, new Date('2027-03-05T23:59:59.999Z'))).toBe(2);
    expect(await countUserEmail(db, other.id, new Date('2027-03-05T12:00:00.000Z'))).toBe(1);
    expect(await countUserEmail(db, user.id, new Date('2027-03-06T00:00:00.000Z'))).toBe(1);

    const rows = await db.select().from(rateLimits);
    const userKey = `u:${user.id}:email:1d`;
    const otherKey = `u:${other.id}:email:1d`;
    expect(
      rows.map((row) => `${row.key} ${row.windowStart.toISOString()} ${String(row.count)}`).sort(),
    ).toEqual(
      [
        `${userKey} 2027-03-05T00:00:00.000Z 2`,
        `${otherKey} 2027-03-05T00:00:00.000Z 1`,
        `${userKey} 2027-03-06T00:00:00.000Z 1`,
      ].sort(),
    );
  });
});
