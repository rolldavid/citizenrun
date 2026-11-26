import { clientErrors } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { signIn } from '../testing/auth.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import type { TestRequestOptions } from '../testing/request.ts';

// CTL-10, through POST /v1/client-errors, an optional write.
const PATH = '/v1/client-errors';
const FOREIGN_ORIGIN = 'https://evil.example.test';

// Every request comes from its own address, so no case nears the per-replica limit.
let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

function validReport(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: null,
    component: null,
    appVersion: '1.4.0',
    platform: 'web',
    frames: [],
    requestId: newId(),
  };
}

function post(testApp: TestApp, options: TestRequestOptions) {
  return testApp.request.post(PATH, { ip: freshIp(), body: validReport(), ...options });
}

async function expectRejected(testApp: TestApp, options: TestRequestOptions): Promise<void> {
  const response = await post(testApp, options);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'origin_rejected' } });
}

async function storedCount(testApp: TestApp): Promise<number> {
  return (await testApp.deps.db.select().from(clientErrors)).length;
}

async function cookieAuth(testApp: TestApp) {
  const user = await insertUser(testApp.deps.db);
  return signIn(testApp.deps.db, user, 'cookie');
}

describe('request-forgery check', () => {
  it('cookie POST with a foreign Origin is 403', async () => {
    const testApp = await createTestApp();
    const auth = await cookieAuth(testApp);
    await expectRejected(testApp, { auth, client: 'web/1.4.0', origin: FOREIGN_ORIGIN });
    expect(await storedCount(testApp)).toBe(0);
  });

  it('cookie POST without Origin is 403', async () => {
    const testApp = await createTestApp();
    const auth = await cookieAuth(testApp);
    await expectRejected(testApp, { auth, client: 'web/1.4.0', origin: null });
    expect(await storedCount(testApp)).toBe(0);
  });

  it('cookie POST without X-OS-Client web is 403', async () => {
    const testApp = await createTestApp();
    const auth = await cookieAuth(testApp);
    await expectRejected(testApp, {
      auth,
      client: 'ios/1.4.0',
      origin: testApp.deps.env.PUBLIC_URL,
    });
    expect(await storedCount(testApp)).toBe(0);
  });

  it('cookie POST from the site with a web client passes', async () => {
    const testApp = await createTestApp();
    const auth = await cookieAuth(testApp);
    const response = await post(testApp, {
      auth,
      client: 'web/1.4.0',
      origin: testApp.deps.env.PUBLIC_URL,
    });
    expect(response.status).toBe(204);
    expect(await storedCount(testApp)).toBe(1);
  });

  it('pre-session web POST from a foreign Origin is 403', async () => {
    const testApp = await createTestApp();
    await expectRejected(testApp, { auth: null, client: 'web/1.4.0', origin: FOREIGN_ORIGIN });
    expect(await storedCount(testApp)).toBe(0);
  });

  it('phone pre-session POST with no Origin passes', async () => {
    const testApp = await createTestApp();
    const response = await post(testApp, { auth: null, client: 'ios/1.4.0', origin: null });
    expect(response.status).toBe(204);
    expect(await storedCount(testApp)).toBe(1);
  });

  it('a phone POST that sends an Origin must match it', async () => {
    const testApp = await createTestApp();
    await expectRejected(testApp, { auth: null, client: 'android/1.4.0', origin: FOREIGN_ORIGIN });
    expect(await storedCount(testApp)).toBe(0);
  });

  it('bearer POST skips the check', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const response = await post(testApp, { auth, client: 'ios/1.4.0', origin: null });
    expect(response.status).toBe(204);
    const foreign = await post(testApp, { auth, client: 'web/1.4.0', origin: FOREIGN_ORIGIN });
    expect(foreign.status).toBe(204);
    expect(await storedCount(testApp)).toBe(2);
  });

  it('GET is never checked', async () => {
    const testApp = await createTestApp();
    const response = await testApp.request.get('/v1/openapi.json', {
      ip: freshIp(),
      client: 'web/1.4.0',
      origin: FOREIGN_ORIGIN,
    });
    expect(response.status).toBe(200);
  });
});
