import { appEvents } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import type { AppEventName } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import { writeAppEvent } from './app-events.ts';

describe('writeAppEvent', () => {
  it('writes one row', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    await writeAppEvent(testApp.deps.db, {
      userId: user.id,
      name: 'account_created',
      props: { method: 'email' },
      platform: 'ios',
    });
    const rows = await testApp.deps.db.select().from(appEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      name: 'account_created',
      props: { method: 'email' },
      platform: 'ios',
    });
    expect(rows[0]?.id).toEqual(expect.any(Number));
  });

  it('commits with the transaction it is given', async () => {
    const testApp = await createTestApp();
    await expect(
      testApp.deps.db.transaction(async (tx) => {
        await writeAppEvent(tx, {
          userId: null,
          name: 'onboarding_done',
          props: {},
          platform: 'web',
        });
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow('fixture rollback');
    expect(await testApp.deps.db.select().from(appEvents)).toEqual([]);
  });

  it('refuses a name outside APP_EVENT_NAMES', async () => {
    const testApp = await createTestApp();
    await expect(
      writeAppEvent(testApp.deps.db, {
        userId: null,
        name: 'fixture_unknown' as AppEventName, // a name the enum lacks, to prove the parse refuses it
        props: {},
        platform: null,
      }),
    ).rejects.toThrow();
    expect(await testApp.deps.db.select().from(appEvents)).toEqual([]);
  });

  it('refuses a nested prop', async () => {
    const testApp = await createTestApp();
    const nested = { method: { inner: 'email' } } as unknown as Record<string, string>; // a nested value the type forbids, to prove the parse refuses it
    await expect(
      writeAppEvent(testApp.deps.db, {
        userId: null,
        name: 'account_created',
        props: nested,
        platform: null,
      }),
    ).rejects.toThrow();
    const tooMany = Object.fromEntries(Array.from({ length: 11 }, (_, n) => [`k${String(n)}`, n]));
    await expect(
      writeAppEvent(testApp.deps.db, {
        userId: null,
        name: 'account_created',
        props: tooMany,
        platform: null,
      }),
    ).rejects.toThrow();
    await expect(
      writeAppEvent(testApp.deps.db, {
        userId: null,
        name: 'account_created',
        props: { method: 'x'.repeat(65) },
        platform: null,
      }),
    ).rejects.toThrow();
    expect(await testApp.deps.db.select().from(appEvents)).toEqual([]);
  });

  it('a logged-out event has user_id null', async () => {
    const testApp = await createTestApp();
    await writeAppEvent(testApp.deps.db, {
      userId: null,
      name: 'onboarding_done',
      props: {},
      platform: null,
    });
    const rows = await testApp.deps.db.select().from(appEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: null,
      name: 'onboarding_done',
      props: {},
      platform: null,
    });
  });
});
