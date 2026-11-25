import { ISSUE_IDS, LEGAL_VERSIONS, PHOTO_MAX_BYTES } from '@citizenrun/shared';
import { incomingUploadKey } from '@citizenrun/shared/storage';
import { marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  getTestDb,
  insertConsents,
  insertDataExport,
  insertUpload,
  insertUser,
  resetDb,
  setUserIssues,
} from './index.ts';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

// The Postgres error under a Drizzle query error: the first error in the cause chain with a code.
function databaseError(error: unknown): { code?: unknown; constraint?: unknown } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string') {
      return current;
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('the account factories', () => {
  it('insertUser writes a valid user with a verified email identity', async () => {
    const user = await insertUser(getTestDb(), {}, { now: NOW });
    expect(user.handle?.startsWith('test_')).toBe(true);
    expect(user.email).toContain(marker());
    expect(user.email?.endsWith('@example.test')).toBe(true);
    expect(user).toMatchObject({
      status: 'active',
      role: 'user',
      ageMethod: 'self_declared',
      ageResult: 'adult',
      ageSourceTier: 'self',
      onboardingStep: 'done',
    });
    expect(user.createdAt.getTime()).toBe(NOW.getTime() - 30 * DAY_MS);
    expect(user.ageCheckedAt?.getTime()).toBe(user.createdAt.getTime());
    expect(user.onboardedAt?.getTime()).toBe(user.createdAt.getTime() + 50_000);
    const identities = await getTestDb().execute<{
      provider: string;
      subject: string;
      email_verified: boolean;
    }>(
      sql`select provider, subject, email_verified from auth_identities where user_id = ${user.id}`,
      'objects',
    );
    expect(identities).toEqual([
      { provider: 'email', subject: user.email?.toLowerCase(), email_verified: true },
    ]);
  });

  it('newAccount makes a user one day old', async () => {
    const user = await insertUser(getTestDb(), { newAccount: true }, { now: NOW });
    expect(user.createdAt.getTime()).toBe(NOW.getTime() - DAY_MS);
  });

  it('insertUser with email null inserts no identity', async () => {
    const user = await insertUser(getTestDb(), { email: null });
    expect(user.email).toBeNull();
    const [found] = await getTestDb().execute<{ n: number }>(
      sql`select count(*)::int as n from auth_identities where user_id = ${user.id}`,
      'objects',
    );
    expect(found?.n).toBe(0);
  });

  it('insertConsents writes the four kinds at the current versions', async () => {
    const user = await insertUser(getTestDb());
    const rows = await insertConsents(getTestDb(), user.id);
    expect(
      rows.map((row) => ({ kind: row.kind, version: row.version, granted: row.granted })),
    ).toEqual([
      { kind: 'terms', version: LEGAL_VERSIONS.terms, granted: true },
      { kind: 'content_policy', version: LEGAL_VERSIONS.content_policy, granted: true },
      { kind: 'privacy_policy', version: LEGAL_VERSIONS.privacy_policy, granted: true },
      { kind: 'ai_screening', version: LEGAL_VERSIONS.ai_screening, granted: true },
    ]);
  });

  it('an override of terms writes that version', async () => {
    const user = await insertUser(getTestDb());
    const rows = await insertConsents(getTestDb(), user.id, { terms: '2020-01-01' });
    expect(rows.find((row) => row.kind === 'terms')?.version).toBe('2020-01-01');
    expect(rows.find((row) => row.kind === 'content_policy')?.version).toBe(
      LEGAL_VERSIONS.content_policy,
    );
  });

  it('setUserIssues defaults to the first three issues, and replaces earlier picks', async () => {
    const user = await insertUser(getTestDb());
    const picked = async (): Promise<{ issue_id: string; starred: boolean }[]> =>
      getTestDb().execute<{ issue_id: string; starred: boolean }>(
        sql`select issue_id, starred from user_issues where user_id = ${user.id} order by issue_id`,
        'objects',
      );
    await setUserIssues(getTestDb(), user.id);
    expect(await picked()).toEqual(
      ISSUE_IDS.slice(0, 3)
        .map((id) => ({ issue_id: id, starred: false }))
        .sort((a, b) => (a.issue_id < b.issue_id ? -1 : 1)),
    );
    await setUserIssues(getTestDb(), user.id, [{ issueId: 'transit', starred: true }]);
    expect(await picked()).toEqual([{ issue_id: 'transit', starred: true }]);
  });

  it('insertUpload builds the key through L-object-keys', async () => {
    const upload = await insertUpload(getTestDb());
    expect(upload.key).toBe(incomingUploadKey(upload.userId, upload.id, 'image/jpeg'));
    expect(upload.maxBytes).toBe(PHOTO_MAX_BYTES);
    expect(upload).toMatchObject({
      kind: 'photo',
      purpose: 'avatar',
      platform: 'ios',
      contentType: 'image/jpeg',
      declaredBytes: 500_000,
      consumedAt: null,
      objectDeletedAt: null,
    });
    const [owner] = await getTestDb().execute<{ n: number }>(
      sql`select count(*)::int as n from users where id = ${upload.userId}`,
      'objects',
    );
    expect(owner?.n).toBe(1);
  });

  it('insertDataExport ready has a key and an expiry 24 hours after ready_at', async () => {
    const queued = await insertDataExport(getTestDb(), {}, { now: NOW });
    expect(queued).toMatchObject({ status: 'queued', objectKey: null, readyAt: null });
    const ready = await insertDataExport(getTestDb(), { status: 'ready' }, { now: NOW });
    expect(ready.objectKey).toBe(`exports/${ready.userId}/${ready.id}.json`);
    expect(ready.readyAt?.getTime()).toBe(NOW.getTime());
    expect(ready.expiresAt?.getTime()).toBe(NOW.getTime() + DAY_MS);
  });

  it('the factory sequence restarts after resetDb', async () => {
    const handles = async (): Promise<(string | null)[]> => {
      const first = await insertUser(getTestDb());
      const second = await insertUser(getTestDb());
      return [first.handle, second.handle];
    };
    const firstRun = await handles();
    await resetDb();
    expect(await handles()).toEqual(firstRun);
  });

  it('a check constraint refuses a stand-in', async () => {
    expect(databaseError(await failure(insertUser(getTestDb(), { handle: 'ab' })))).toMatchObject({
      code: '23514',
      constraint: 'users_handle_check',
    });
    const user = await insertUser(getTestDb());
    expect(
      databaseError(
        await failure(
          insertUpload(getTestDb(), {
            userId: user.id,
            contentType: 'image/heic',
            key: `incoming/${user.id}/fixture.heic`,
          }),
        ),
      ),
    ).toMatchObject({ code: '23514', constraint: 'uploads_content_type_check' });
  });
});
