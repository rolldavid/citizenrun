import {
  SEED_USER_IDS,
  fetchPresignedGet,
  getTestDb,
  getTestObject,
  seedUsersStep,
} from '@citizenrun/db/testing';
import type { Me } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/app.ts';
import { signIn } from '../testing/auth.ts';

// TEST-seed-users `seed users need no agreement`: seed step 010-users on the test database and the
// test media bucket, read back through GET /v1/me. The seed's own test file cannot import the API.

const MINUTE_MS = 60_000;
const IOS = 'ios/1.4.0';

describe('the seed users', () => {
  it('seed users need no agreement', async () => {
    const testApp = await createTestApp();
    const now = testApp.deps.clock.now();
    const anchor = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await getTestDb().transaction(async (tx) => {
      await seedUsersStep(tx, { anchor, media: testApp.deps.storage.media });
    });

    const read = async (id: string): Promise<Me> => {
      const auth = await signIn(testApp.deps.db, { id }, 'bearer');
      const response = await testApp.request.get('/v1/me', { auth, client: IOS });
      expect(response.status).toBe(200);
      return response.json<Me>();
    };

    const first = await read(SEED_USER_IDS['01']);
    const newAccount = await read(SEED_USER_IDS['45']);
    const admin = await read(SEED_USER_IDS.admin);

    for (const me of [first, newAccount, admin]) {
      expect(me.consents.needed).toEqual([]);
      expect(me.onboardingStep).toBe('done');
      expect(me.age?.method).toBe('none');
      expect(me.age?.sourceTier).toBeNull();
    }
    expect(first.handle).toBe('seed_user_01');
    expect(newAccount.handle).toBe('seed_user_45');
    expect(admin.handle).toBe('seed_admin');
    expect(admin.role).toBe('admin');
    expect(first.role).toBe('user');

    // seed_user_01's avatar names an object that exists, and its link serves it.
    const avatar = first.avatar;
    expect(avatar).not.toBeNull();
    expect(avatar?.key.endsWith('/320.jpg')).toBe(true);
    const stored = await getTestObject('media', avatar?.key ?? '');
    expect(stored).not.toBeNull();
    const served = await fetchPresignedGet(avatar?.url ?? '');
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body).equals(Buffer.from(stored ?? new Uint8Array()))).toBe(true);
    expect(newAccount.avatar).toBeNull();
    expect(admin.avatar).toBeNull();
  });
});
