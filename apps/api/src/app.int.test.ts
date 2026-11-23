import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { marker } from '@citizenrun/shared/testing';
import { createApp } from './app.ts';
import { respond } from './respond.ts';
import { createTestApp } from './testing/app.ts';
import type { TestApp } from './testing/app.ts';

const ProbeSchema = z.object({ a: z.string() });

// A probe route that is not an OpenAPI operation, so the /v1 steps pass it on without a client
// header. Added right after createTestApp resolves: Hono refuses routes after its first request.
function addExtraKeyProbe(testApp: TestApp): void {
  const probeData = { a: 'x', extra: marker() };
  testApp.app.get('/v1/__probe/extra-key', (c) => respond(c, ProbeSchema, probeData));
}

// Never called: it compiles only while createApp refuses the option.
function passesTheDroppedOption(testApp: TestApp): void {
  // @ts-expect-error: createApp has no strictResponses option
  createApp(testApp.deps, { strictResponses: true });
}

describe('createApp', () => {
  it('the test app answers in strict mode', async () => {
    const testApp = await createTestApp();
    addExtraKeyProbe(testApp);
    const response = await testApp.request.get('/v1/__probe/extra-key', { client: null });
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).not.toBeNull();
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
    expect(text).not.toContain(marker());
    const errorLines = testApp.logs.filter((line) => line.parsed['event'] === 'request.error');
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]?.parsed).toMatchObject({ errorClass: 'ResponseShapeError' });
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
    }
  });

  it('an app outside the test runtime strips undeclared keys', async () => {
    const testApp = await createTestApp({ env: { NODE_ENV: 'production' } });
    addExtraKeyProbe(testApp);
    const response = await testApp.request.get('/v1/__probe/extra-key', { client: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ a: 'x' });
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
    }
  });

  it('the request variables start null', async () => {
    const testApp = await createTestApp();
    testApp.app.get('/v1/__probe/variables', (c) =>
      c.json({
        client: c.get('client'),
        errorCode: c.get('errorCode'),
        retryAfterSeconds: c.get('retryAfterSeconds'),
        respondMode: c.get('respondMode'),
      }),
    );
    const response = await testApp.request.get('/v1/__probe/variables');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      client: null,
      errorCode: null,
      retryAfterSeconds: null,
      respondMode: 'strict',
    });
  });

  it('createApp takes no strictResponses option', () => {
    // The assertion is the compiler's: the expect-error line above fails typecheck if the option exists.
    expect(typeof passesTheDroppedOption).toBe('function');
  });
});
