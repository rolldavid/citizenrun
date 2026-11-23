import { describe, expect, it } from 'vitest';
import { ApiError } from '@citizenrun/shared';
import { createRouter } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError } from './handle-error.ts';
import { requestId } from './request-id.ts';
import { requestVariables } from './variables.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function buildApp() {
  const deps = createUnitDeps();
  const seen: string[] = [];
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('*', requestId());
  app.get('/v1/ok', (c) => {
    seen.push(c.get('requestId'));
    return c.json({ ok: true });
  });
  app.get('/v1/boom', (c) => {
    seen.push(c.get('requestId'));
    throw new ApiError('not_found');
  });
  // A handler that builds its own Response, outside the context's prepared headers.
  app.get('/v1/raw', () => new Response('raw'));
  app.onError(handleError(deps));
  return { app, seen };
}

describe('requestId', () => {
  it('every response carries a new request id', async () => {
    const { app, seen } = buildApp();
    const first = await app.request('/v1/ok');
    const second = await app.request('/v1/ok');
    const failed = await app.request('/v1/boom');

    expect(first.status).toBe(200);
    expect(failed.status).toBe(404);
    const ids = [first, second, failed].map((response) => response.headers.get('x-request-id'));
    for (const id of ids) {
      expect(id).toMatch(UUID_V7);
    }
    expect(new Set(ids).size).toBe(3);
    // The id the handler saw is the one on its response, the error response included.
    expect(ids).toEqual(seen);

    const raw = await app.request('/v1/raw');
    expect(raw.headers.get('x-request-id')).toMatch(UUID_V7);
  });

  it('an incoming X-Request-Id is ignored', async () => {
    const { app, seen } = buildApp();
    const sent = '0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60';
    const response = await app.request('/v1/ok', { headers: { 'X-Request-Id': sent } });
    const id = response.headers.get('x-request-id');
    expect(id).toMatch(UUID_V7);
    expect(id).not.toBe(sent);
    expect(seen).toEqual([id]);
  });
});
