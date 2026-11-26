import { adminActions, users } from '@citizenrun/db';
import { getTestDb, insertUser } from '@citizenrun/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parseAdminEmails } from '../../middleware/gates.ts';
import { applyAdminElevation } from './admin-elevation.ts';

const ADMIN_EMAILS = parseAdminEmails(['admin@example.test']);

class Rollback extends Error {}

async function roleOf(userId: string): Promise<string | undefined> {
  const [row] = await getTestDb()
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  return row?.role;
}

async function auditRowsFor(userId: string) {
  return getTestDb().select().from(adminActions).where(eq(adminActions.adminId, userId));
}

describe('admin elevation', () => {
  it('promotion writes admin.bootstrap', async () => {
    const db = getTestDb();
    const user = await insertUser(db, { email: 'Admin@example.test' });

    // A rollback of the caller's transaction leaves neither the role nor the row.
    await expect(
      db.transaction(async (tx) => {
        expect(await applyAdminElevation(tx, { userId: user.id, adminEmails: ADMIN_EMAILS })).toBe(
          true,
        );
        throw new Rollback('rollback');
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await roleOf(user.id)).toBe('user');
    expect(await auditRowsFor(user.id)).toEqual([]);

    const promoted = await db.transaction((tx) =>
      applyAdminElevation(tx, { userId: user.id, adminEmails: ADMIN_EMAILS }),
    );
    expect(promoted).toBe(true);
    expect(await roleOf(user.id)).toBe('admin');
    const rows = await auditRowsFor(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      adminId: user.id,
      action: 'admin.bootstrap',
      target: { type: 'user', id: user.id },
    });
  });

  it('an admin signing in again writes nothing', async () => {
    const db = getTestDb();
    const user = await insertUser(db, { email: 'admin@example.test' });
    expect(
      await db.transaction((tx) =>
        applyAdminElevation(tx, { userId: user.id, adminEmails: ADMIN_EMAILS }),
      ),
    ).toBe(true);
    expect(
      await db.transaction((tx) =>
        applyAdminElevation(tx, { userId: user.id, adminEmails: ADMIN_EMAILS }),
      ),
    ).toBe(false);
    expect(await roleOf(user.id)).toBe('admin');
    expect(await auditRowsFor(user.id)).toHaveLength(1);

    // An account made an admin some other way gains no row at sign-in.
    const other = await insertUser(db, { email: 'admin2@example.test', role: 'admin' });
    const both = parseAdminEmails(['admin@example.test', 'admin2@example.test']);
    expect(
      await db.transaction((tx) =>
        applyAdminElevation(tx, { userId: other.id, adminEmails: both }),
      ),
    ).toBe(false);
    expect(await auditRowsFor(other.id)).toEqual([]);
  });

  it('an unlisted email writes nothing', async () => {
    const db = getTestDb();
    const unlisted = await insertUser(db, { email: 'someone@example.test' });
    const noEmail = await insertUser(db, { email: null });
    for (const user of [unlisted, noEmail]) {
      expect(
        await db.transaction((tx) =>
          applyAdminElevation(tx, { userId: user.id, adminEmails: ADMIN_EMAILS }),
        ),
      ).toBe(false);
      expect(await roleOf(user.id)).toBe('user');
      expect(await auditRowsFor(user.id)).toEqual([]);
    }
    // An empty list promotes nobody, a listed address included.
    const listed = await insertUser(db, { email: 'admin@example.test' });
    expect(
      await db.transaction((tx) =>
        applyAdminElevation(tx, { userId: listed.id, adminEmails: parseAdminEmails(null) }),
      ),
    ).toBe(false);
    expect(await roleOf(listed.id)).toBe('user');
    expect(await auditRowsFor(listed.id)).toEqual([]);
  });
});
