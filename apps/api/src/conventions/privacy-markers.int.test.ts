import { bookmarks, issues, userDistricts } from '@citizenrun/db';
import {
  insertBookmark,
  insertConsents,
  insertDataExport,
  insertDistrict,
  insertOffice,
  insertUser,
  setUserDistricts,
  setUserIssues,
} from '@citizenrun/db/testing';
import { marker } from '@citizenrun/shared/testing';
import { asc, eq } from 'drizzle-orm';
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

type CallParameters = { path?: Record<string, string>; query: Record<string, string> };

/** Operations whose parameters the fixtures cannot fill, with the parameters they are called with. */
function explicitParameters(target: Target): Readonly<Record<string, CallParameters>> {
  return {
    checkHandle: { query: { handle: 'fixture_b' } },
    // The office A saved, by its slug and by its id.
    getOffice: { path: { idOrSlug: target.officeSlug }, query: {} },
    listOfficeCandidates: { path: { id: target.officeId }, query: {} },
  };
}

/** The document's path with each `{name}` replaced by its explicit value. */
function filledPath(path: string, values: Record<string, string> = {}): string {
  return path.replaceAll(/\{(.+?)\}/g, (whole, name: string) => values[name] ?? whole);
}

// An instant that appears nowhere else: target user A's age record.
const AGE_CHECKED_AT = '1999-01-02T03:04:05.678Z';
// Another such instant: when A's districts went stale.
const DISTRICTS_STALE_AT = '1999-02-03T04:05:06.789Z';
// What a response would say if it told another viewer that A saved an office.
const BOOKMARKED = '"bookmarked":true';
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

type Target = {
  userId: string;
  picks: { issueId: string; starred: boolean }[];
  districtIds: string[];
  officeId: string;
  officeSlug: string;
};

/** Target user A, with the marker in every private column of an account. */
async function insertTarget(testApp: TestApp, issueIds: readonly string[]): Promise<Target> {
  const { db } = testApp.deps;
  const value = marker();
  // The factory's email is `test_<seq>.<marker>@example.test`.
  const user = await insertUser(db, {
    ageCheckedAt: new Date(AGE_CHECKED_AT),
    locationPrecision: 'exact',
    districtsStaleAt: new Date(DISTRICTS_STALE_AT),
  });
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
  // Two exact districts made for A alone, which no office uses, so no public response may name
  // them; their names carry the marker. Only their ids are stored for A.
  const districts = [
    await insertDistrict(db, { name: `Fixture District ${value} 1` }),
    await insertDistrict(db, { name: `Fixture District ${value} 2` }),
  ];
  const districtIds = districts.map((district) => district.id);
  await setUserDistricts(db, user.id, districtIds);
  // The office is public and carries no marker; only the fact that A saved it is private.
  const office = await insertOffice(db);
  await insertBookmark(db, { userId: user.id, officeId: office.id });
  return { userId: user.id, picks, districtIds, officeId: office.id, officeSlug: office.slug };
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
    ...target.districtIds,
    DISTRICTS_STALE_AT,
    BOOKMARKED,
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
    const stored = await testApp.deps.db
      .select({ districtId: userDistricts.districtId })
      .from(userDistricts)
      .where(eq(userDistricts.userId, target.userId));
    expect(stored.map((row) => row.districtId).sort()).toEqual([...target.districtIds].sort());
    const saved = await testApp.deps.db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.userId, target.userId));
    expect(saved).toHaveLength(1);

    const explicit = explicitParameters(target);
    const operations = getOperations();
    const unfillable = operations
      .filter((operation) => operation.hasParameters)
      .filter((operation) => !(operation.operationId in explicit))
      .map((operation) => operation.operationId);
    expect(unfillable).toEqual([]);
    const known = new Set(operations.map((operation) => operation.operationId));
    expect(Object.keys(explicit).filter((id) => !known.has(id))).toEqual([]);

    const called = new Set<string>();
    for (const operation of operations) {
      const parameters = explicit[operation.operationId];
      const path = filledPath(operation.path, parameters?.path);
      const query = parameters?.query ?? {};
      for (const auth of [null, viewer]) {
        const response = await testApp.request.get(path, { auth, client: IOS, query });
        const body = (await response.text()).toLowerCase();
        if (operation.operationId === 'getOffice') {
          // INV-06: the office A saved is not saved for anyone else.
          expect(response.status).toBe(200);
          expect(body).toContain('"bookmarked":false');
        }
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
    expect(called).toContain('listOfficeTypes');
    expect(called).toContain('getOffice');
    expect(called).toContain('listOfficeCandidates');
  });
});
