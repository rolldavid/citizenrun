import { issues } from '@citizenrun/db';
import {
  insertConsents,
  insertDataExport,
  insertUser,
  setUserIssues,
} from '@citizenrun/db/testing';
import { marker } from '@citizenrun/shared/testing';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../openapi.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import { signIn } from '../testing/auth.ts';
import { insertIdentity } from '../testing/factories.ts';
import type { TestAuth } from '../testing/request.ts';

// TEST-privacy-markers: a user with a marker in every private column that exists so far is read
// through every GET operation of the document, logged out and by a second user; no body holds it.
// The operations come from the document, so a later route is covered by adding nothing.

/** Operations whose parameters the fixtures cannot fill, with the parameters they are called with. */
const EXPLICIT_PARAMETERS: Readonly<Record<string, { query: Record<string, string> }>> = {
  checkHandle: { query: { handle: 'fixture_b' } },
};

// An instant that appears nowhere else: target user A's age record.
const AGE_CHECKED_AT = '1999-01-02T03:04:05.678Z';
// The 0-based `sort` positions of the two users' issue picks; A stars the last of its three.
const A_PICK_POSITIONS = [16, 17, 18] as const;
const A_STARRED_POSITION = 18;
const B_PICK_POSITIONS = [0, 1, 2] as const;
const IOS = 'ios/1.4.0';

type GetOperation = {
  path: string;
  operationId: string;
  hasParameters: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every GET operation of the document, and whether it takes a path or query parameter. */
function getOperations(): GetOperation[] {
  const paths = buildOpenApiDocument()['paths'];
  if (!isRecord(paths)) {
    throw new Error('The document has no paths.');
  }
  const found: GetOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    const operation = isRecord(item) ? item['get'] : undefined;
    if (!isRecord(operation)) {
      continue;
    }
    const operationId = operation['operationId'];
    if (typeof operationId !== 'string') {
      throw new Error(`GET ${path} has no operation id.`);
    }
    const parameters = operation['parameters'];
    const hasParameters =
      path.includes('{') ||
      (Array.isArray(parameters) &&
        parameters.some((parameter) => isRecord(parameter) && parameter['in'] === 'query'));
    found.push({ path, operationId, hasParameters });
  }
  return found;
}

// A value's base64 forms, one per byte alignment of the value inside the encoded text.
function base64Forms(value: string): string[] {
  const bytes = Buffer.from(value, 'utf8');
  return [0, 1, 2].map((offset) => {
    const shifted = Buffer.concat([Buffer.alloc(offset), bytes]);
    const encoded = shifted.toString('base64');
    const skipGroups = offset === 0 ? 0 : 1;
    const wholeGroups = Math.floor(shifted.length / 3) - skipGroups;
    return encoded.slice(skipGroups * 4, (skipGroups + wholeGroups) * 4);
  });
}

type Target = { userId: string; picks: { issueId: string; starred: boolean }[] };

/** Target user A, with the marker in every private column of an account. */
async function insertTarget(testApp: TestApp, issueIds: readonly string[]): Promise<Target> {
  const { db } = testApp.deps;
  const value = marker();
  // The factory's email is `test_<seq>.<marker>@example.test`.
  const user = await insertUser(db, { ageCheckedAt: new Date(AGE_CHECKED_AT) });
  expect(user.email).toContain(value);
  await insertIdentity(db, {
    userId: user.id,
    provider: 'google',
    subject: `sub-${value}`,
    email: `g.${value}@example.test`,
    emailVerified: true,
  });
  await insertIdentity(db, {
    userId: user.id,
    provider: 'apple',
    subject: `apple-${value}`,
    email: null,
    clientId: 'fixture.client',
    refreshTokenEnc: new Uint8Array(Buffer.from(value, 'utf8')),
  });
  const version = `v-${value}`;
  await insertConsents(db, user.id, {
    terms: version,
    content_policy: version,
    privacy_policy: version,
    ai_screening: version,
  });
  const picks = A_PICK_POSITIONS.map((position) => ({
    issueId: issueIds[position] ?? '',
    starred: position === A_STARRED_POSITION,
  }));
  await setUserIssues(db, user.id, picks);
  await insertDataExport(db, { userId: user.id, status: 'ready' });
  return { userId: user.id, picks };
}

/** Second user B, with its own picks and the current consents, freshly signed in by bearer. */
async function insertViewer(testApp: TestApp, issueIds: readonly string[]): Promise<TestAuth> {
  const { db } = testApp.deps;
  // B's own email carries no marker, so its own account answer can be read for A's.
  const user = await insertUser(db, {
    handle: 'fixture_viewer',
    email: 'fixture.viewer@example.test',
  });
  await insertConsents(db, user.id);
  await setUserIssues(
    db,
    user.id,
    B_PICK_POSITIONS.map((position) => ({ issueId: issueIds[position] ?? '', starred: false })),
  );
  return signIn(db, user, 'bearer');
}

/** The texts no body may hold, compared lower-cased. */
function forbiddenTexts(target: Target): string[] {
  const value = marker();
  return [
    value,
    encodeURIComponent(value),
    ...base64Forms(value),
    ...base64Forms(value.toLowerCase()),
    target.userId,
    AGE_CHECKED_AT,
    JSON.stringify(target.picks),
    ...target.picks.map((pick) => JSON.stringify(pick)),
  ].map((text) => text.toLowerCase());
}

describe('the private columns', () => {
  it('private columns stay private', async () => {
    const testApp = await createTestApp();
    const issueRows = await testApp.deps.db
      .select({ id: issues.id })
      .from(issues)
      .orderBy(asc(issues.sort));
    const issueIds = issueRows.map((row) => row.id);
    expect(issueIds.length).toBeGreaterThan(A_STARRED_POSITION);

    const target = await insertTarget(testApp, issueIds);
    const viewer = await insertViewer(testApp, issueIds);
    const forbidden = forbiddenTexts(target);

    // The marker is where the test put it: A's own account answer holds A's email.
    const own = await signIn(testApp.deps.db, { id: target.userId }, 'bearer');
    const ownBody = await (await testApp.request.get('/v1/me', { auth: own, client: IOS })).text();
    expect(ownBody.toLowerCase()).toContain(marker().toLowerCase());

    const operations = getOperations();
    const unfillable = operations
      .filter((operation) => operation.hasParameters)
      .filter((operation) => !(operation.operationId in EXPLICIT_PARAMETERS))
      .map((operation) => operation.operationId);
    expect(unfillable).toEqual([]);
    const known = new Set(operations.map((operation) => operation.operationId));
    expect(Object.keys(EXPLICIT_PARAMETERS).filter((id) => !known.has(id))).toEqual([]);

    const called = new Set<string>();
    for (const operation of operations) {
      const query = EXPLICIT_PARAMETERS[operation.operationId]?.query ?? {};
      for (const auth of [null, viewer]) {
        const response = await testApp.request.get(operation.path, { auth, client: IOS, query });
        const body = (await response.text()).toLowerCase();
        for (const text of forbidden) {
          expect(
            body,
            `${operation.operationId} as ${auth === null ? 'logged out' : 'B'}`,
          ).not.toContain(text);
        }
      }
      called.add(operation.operationId);
    }
    expect([...called].sort()).toEqual([...known].sort());
    expect(called).toContain('getMe');
    expect(called).toContain('getExport');
    expect(called).toContain('listIssues');
  });
});
