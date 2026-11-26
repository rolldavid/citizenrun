import { ERROR_CODES, newId } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES } from '../config/public-routes.ts';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import type { RateLimitRule } from '../config/rate-limits.ts';
import { buildOpenApiDocument } from '../openapi.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import type { TestRequestOptions, TestResponse } from '../testing/request.ts';

// TEST-api-access-matrix with TEST-public-routes: one table-driven pass over the operations of the
// document, so a later route is covered by adding nothing. The app is built as production runs,
// with the development routes off.

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];

type Operation = {
  method: Method;
  /** The document's path, `{param}` as OpenAPI writes it. */
  path: string;
  operationId: string;
  route: Record<string, unknown>;
};

const IOS = 'ios/1.4.0';
const WEB = 'web/1.4.0';
const FOREIGN_ORIGIN = 'https://evil.example.test';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The writes a suspended account may still make (L-suspension) that exist so far.
const ALLOW_WHEN_SUSPENDED = [
  'appleSignInHandoff',
  'deleteMe',
  'logout',
  'recordAgeSignal',
  'recordConsent',
  'requestExport',
  'signInWithApple',
  'signInWithGoogle',
  'verifyEmailSignIn',
];
// The routes that need a sign-in within 15 minutes: export, its download and deletion.
const RECENT_SIGN_IN = ['deleteMe', 'getExportDownload', 'requestExport'];
// The provider routes verified by signature, which skip the request-forgery check (D-169, D-242).
const ORIGIN_EXEMPT = ['appleSignInCallback', 'receiveAppleNotification'];

// The level and policy of each civic route: operation id, x-route.auth and x-route.rateLimit.
const CIVIC_ROUTES: ReadonlyArray<readonly [string, string, string]> = [
  ['suggestPlaces', 'user', 'geo.suggest'],
  ['listOfficeTypes', 'optional', 'ref.read'],
  ['setLocation', 'user', 'me.location'],
  ['clearLocation', 'user', 'me.location'],
  ['listOffices', 'user', 'explore_list'],
  ['getOffice', 'optional', 'civic_read'],
  ['listOfficeCandidates', 'optional', 'civic_read'],
  ['followOffice', 'onboarded', 'office_toggle'],
  ['bookmarkOffice', 'onboarded', 'office_toggle'],
  ['unfollowOffice', 'user', 'office_toggle'],
  ['unbookmarkOffice', 'user', 'office_toggle'],
  ['createFieldReport', 'onboarded', 'field_report'],
  ['getPerson', 'optional', 'civic_read'],
];

// The per-address rule each logged-out civic read holds, as the contracts write it.
const CIVIC_IP_RULE: RateLimitRule = {
  subject: 'ip',
  action: 'civic',
  limit: 240,
  window: '1m',
  store: 'memory',
  when: 'logged_out',
};
const REF_READ_IP_RULE: RateLimitRule = {
  subject: 'ip',
  action: 'ref_read',
  limit: 120,
  window: '1m',
  store: 'memory',
};
// The `when` values under which a rule counts a logged-out request.
const LOGGED_OUT_WHEN: ReadonlyArray<RateLimitRule['when']> = [undefined, 'logged_out'];
const EXACT_IP_RULES: Readonly<Record<string, RateLimitRule>> = {
  getOffice: CIVIC_IP_RULE,
  listOfficeCandidates: CIVIC_IP_RULE,
  getPerson: CIVIC_IP_RULE,
  listOfficeTypes: REF_READ_IP_RULE,
};

// Every request comes from its own address, so no case nears a per-address limit.
let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every operation of the document built as production runs. */
function documentOperations(): Operation[] {
  const paths = buildOpenApiDocument()['paths'];
  if (!isRecord(paths)) {
    throw new Error('The document has no paths.');
  }
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = isRecord(item) ? item[method] : undefined;
      if (!isRecord(operation)) {
        continue;
      }
      const operationId = operation['operationId'];
      const route = operation['x-route'];
      if (typeof operationId !== 'string' || !isRecord(route)) {
        throw new Error(`${method} ${path} has no operation id or x-route.`);
      }
      operations.push({ method, path, operationId, route });
    }
  }
  return operations;
}

/** `"<METHOD> <path>"` with OpenAPI's `{param}` written `:param`, as `PUBLIC_ROUTES` lists it. */
function routeKey(operation: Operation): string {
  return `${operation.method.toUpperCase()} ${operation.path.replaceAll(/\{(.+?)\}/g, ':$1')}`;
}

function isV1(operation: Operation): boolean {
  return operation.path.startsWith('/v1/');
}

function idsWhere(predicate: (operation: Operation) => boolean): string[] {
  return documentOperations()
    .filter(predicate)
    .map((operation) => operation.operationId)
    .sort();
}

/** A logged-out request to `operation`, every path parameter filled with a fresh id. */
function sendLoggedOut(testApp: TestApp, operation: Operation): Promise<TestResponse> {
  const path = operation.path.replaceAll(/\{.+?\}/g, () => newId());
  const options: TestRequestOptions = { auth: null, client: IOS, ip: freshIp() };
  if (operation.method !== 'get') {
    options.body = {};
  }
  return testApp.request[operation.method](path, options);
}

async function expectError(response: TestResponse, code: 'unauthenticated' | 'origin_rejected') {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(await response.json()).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: {} },
  });
}

describe('the access matrix', () => {
  it('logged-out routes are exactly the allow-list', () => {
    const loggedOut = documentOperations()
      .filter(isV1)
      .filter(
        (operation) => operation.route['auth'] === 'none' || operation.route['auth'] === 'optional',
      )
      .map(routeKey)
      .sort();
    expect(loggedOut).toEqual([...PUBLIC_ROUTES].sort());
    // Every such route also says so in its metadata (L-public-routes).
    const unmarked = documentOperations()
      .filter(isV1)
      .filter((operation) => PUBLIC_ROUTES.some((entry) => entry === routeKey(operation)))
      .filter((operation) => operation.route['public'] !== true)
      .map(routeKey);
    expect(unmarked).toEqual([]);
    // The development mailbox is hidden, so the comparison runs as production builds the app.
    expect(loggedOut).not.toContain('POST /v1/dev/mailbox');
  });

  it('every other route refuses a logged-out request', async () => {
    const testApp = await createTestApp();
    const listed: ReadonlySet<string> = new Set(PUBLIC_ROUTES);
    const guarded = documentOperations()
      .filter(isV1)
      .filter((operation) => !listed.has(routeKey(operation)));
    expect(guarded.length).toBeGreaterThan(0);
    const answered: string[] = [];
    for (const operation of guarded) {
      const response = await sendLoggedOut(testApp, operation);
      await expectError(response, 'unauthenticated');
      answered.push(operation.operationId);
    }
    expect(answered).toContain('getMe');
    expect(answered).toContain('createUpload');
  });

  it('exempt routes are exactly three kinds', async () => {
    // The provider routes verified by signature. The socket upgrade arrives later and checks Origin itself.
    expect(idsWhere((operation) => operation.route['originCheck'] === 'exempt')).toEqual(
      ORIGIN_EXEMPT,
    );

    // The pre-session sign-in calls pass the check by its third row: a phone with no Origin and no
    // cookie is allowed, a browser from another site is refused.
    const testApp = await createTestApp();
    const fromPhone = await testApp.request.post('/v1/auth/email/start', {
      client: IOS,
      origin: null,
      ip: freshIp(),
      body: { email: 'access.phone@example.test' },
    });
    expect(fromPhone.status).toBe(200);
    expect(testApp.fakes.mailer.sent).toHaveLength(1);

    const fromForeignSite = await testApp.request.post('/v1/auth/email/start', {
      client: WEB,
      origin: FOREIGN_ORIGIN,
      ip: freshIp(),
      body: { email: 'access.browser@example.test' },
    });
    await expectError(fromForeignSite, 'origin_rejected');
    expect(testApp.fakes.mailer.sent).toHaveLength(1);
  });

  it('no route is in the admin area', () => {
    const operations = documentOperations();
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.filter((operation) => operation.route['auth'] === 'admin')).toEqual([]);
    expect(operations.filter((operation) => operation.path.startsWith('/v1/admin'))).toEqual([]);
  });

  it('civic routes declare their levels and policies', () => {
    const byId = new Map(
      documentOperations().map((operation) => [operation.operationId, operation]),
    );
    const declared = CIVIC_ROUTES.map(([operationId]) => {
      const route = byId.get(operationId)?.route;
      return [operationId, route?.['auth'], route?.['rateLimit']];
    });
    expect(declared).toEqual(CIVIC_ROUTES);
  });

  it('logged-out routes are limited per address', () => {
    const policies: Readonly<Record<string, readonly RateLimitRule[]>> = RATE_LIMIT_POLICIES;
    const byKey = new Map(
      documentOperations().map((operation) => [routeKey(operation), operation]),
    );
    const checked: string[] = [];
    for (const entry of PUBLIC_ROUTES) {
      const operation = byKey.get(entry);
      expect(operation, entry).toBeDefined();
      if (operation === undefined) {
        continue;
      }
      const policy = operation.route['rateLimit'];
      const label = `${operation.operationId} (${String(policy)})`;
      expect(typeof policy, label).toBe('string');
      const rules = typeof policy === 'string' ? policies[policy] : undefined;
      expect(rules, label).toBeDefined();
      const perAddress = (rules ?? []).filter(
        (rule) => rule.subject === 'ip' && LOGGED_OUT_WHEN.includes(rule.when),
      );
      expect(
        perAddress.length,
        `${label} counts no logged-out request per address`,
      ).toBeGreaterThan(0);
      const exact = EXACT_IP_RULES[operation.operationId];
      if (exact !== undefined) {
        expect(perAddress, label).toContainEqual(exact);
      }
      checked.push(operation.operationId);
    }
    expect(checked.sort()).toEqual(expect.arrayContaining(Object.keys(EXACT_IP_RULES).sort()));
  });

  it('allowWhenSuspended routes are exactly the listed writes', () => {
    expect(idsWhere((operation) => operation.route['allowWhenSuspended'] === true)).toEqual(
      ALLOW_WHEN_SUSPENDED,
    );
  });

  it('recent sign-in routes are exactly export and deletion', () => {
    expect(idsWhere((operation) => operation.route['recentSignIn'] === '15m')).toEqual(
      RECENT_SIGN_IN,
    );
  });
});
