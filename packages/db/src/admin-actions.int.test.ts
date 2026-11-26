import { newId } from '@citizenrun/shared';
import type { SystemAdminAction } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATIC_ADMIN_ID, insertAdminAction, recordSystemAdminAction } from './admin-actions.ts';
import type { AdminActionTarget } from './admin-actions.ts';
import { adminActions } from './schema/moderation.ts';
import { captureLogs, getTestDb } from './testing/index.ts';

class Rollback extends Error {}

async function rowsOf(adminId: string) {
  return getTestDb().select().from(adminActions).where(eq(adminActions.adminId, adminId));
}

function bundleTarget(id: string): AdminActionTarget {
  return {
    type: 'data_bundle',
    id,
    version: '20270115T060000Z-full',
    from_status: 'rejected',
    note: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('insertAdminAction', () => {
  it("writes one row in the caller's transaction", async () => {
    const db = getTestDb();
    const adminId = newId();
    const target = bundleTarget(newId());
    const id = await db.transaction((tx) =>
      insertAdminAction(tx, { adminId, action: 'bundle.reload', target }),
    );
    const rows = await rowsOf(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, adminId, action: 'bundle.reload', target });
  });

  it('a rollback leaves no row', async () => {
    const db = getTestDb();
    const adminId = newId();
    let written: string | null = null;
    await expect(
      db.transaction(async (tx) => {
        written = await insertAdminAction(tx, {
          adminId,
          action: 'bundle.reload',
          target: bundleTarget(newId()),
        });
        throw new Rollback('rollback');
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(written).not.toBeNull();
    expect(await rowsOf(adminId)).toEqual([]);
  });

  it('refuses a target that is not JSON', async () => {
    const db = getTestDb();
    const adminId = newId();
    const target: AdminActionTarget = { type: 'data_bundle', id: newId(), n: 1n };
    await expect(
      db.transaction((tx) => insertAdminAction(tx, { adminId, action: 'bundle.reload', target })),
    ).rejects.toThrow('The admin action target is not valid.');
    expect(await rowsOf(adminId)).toEqual([]);
  });

  it('refuses a target without its type or id', async () => {
    const db = getTestDb();
    const adminId = newId();
    const id = newId();
    const targets = [
      { id },
      { type: 'data_bundle' },
      { type: 'data_bundle', id: 7 },
      { type: '', id },
    ] as unknown as AdminActionTarget[]; // shapes the type forbids, as an untyped caller could send
    for (const target of targets) {
      await expect(
        db.transaction((tx) => insertAdminAction(tx, { adminId, action: 'bundle.reload', target })),
      ).rejects.toThrow('The admin action target is not valid.');
    }
    expect(await rowsOf(adminId)).toEqual([]);
  });

  it('writes no log line', async () => {
    const db = getTestDb();
    const logs = captureLogs();
    logs.clear();
    const consoleCalls = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    const adminId = newId();
    await db.transaction((tx) =>
      insertAdminAction(tx, { adminId, action: 'bundle.reload', target: bundleTarget(newId()) }),
    );
    await db.transaction((tx) =>
      recordSystemAdminAction(tx, {
        adminId,
        action: 'admin.bootstrap',
        target: { type: 'user', id: adminId },
      }),
    );
    expect(await rowsOf(adminId)).toHaveLength(2);
    expect(logs.lines).toEqual([]);
    for (const call of consoleCalls) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});

describe('recordSystemAdminAction', () => {
  it('the system writer accepts only its list', async () => {
    const db = getTestDb();
    const adminId = newId();
    const id = await db.transaction((tx) =>
      recordSystemAdminAction(tx, {
        adminId,
        action: 'admin.bootstrap',
        target: { type: 'user', id: adminId },
      }),
    );
    const rows = await rowsOf(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      adminId,
      action: 'admin.bootstrap',
      target: { type: 'user', id: adminId },
    });

    const other = newId();
    const routeAction = 'bundle.reload' as SystemAdminAction; // an admin route's action, past the type
    await expect(
      db.transaction((tx) =>
        recordSystemAdminAction(tx, {
          adminId: other,
          action: routeAction,
          target: { type: 'data_bundle', id: newId() },
        }),
      ),
    ).rejects.toThrow('The admin action is not a system action.');
    expect(await rowsOf(other)).toEqual([]);
  });

  it('the automatic id is the nil uuid', () => {
    expect(AUTOMATIC_ADMIN_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});
