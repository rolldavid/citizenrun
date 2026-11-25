import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.ts';
import { apiFetch, configureApiClient } from './mutator.ts';
import type { ApiClientConfig } from './mutator.ts';

type Answer = { status: number; body?: string; headers?: Record<string, string> };
type Recorded = { url: string; init: RequestInit };

const ORIGIN = 'https://api.example.test';

function envelope(code: string, fields: Record<string, string> = {}): string {
  return JSON.stringify({ error: { code, message: 'x', fields } });
}

/** Installs a fake `fetch` that answers each call from `answers` in order and records the request. */
function fakeFetch(...answers: Answer[]): Recorded[] {
  const calls: Recorded[] = [];
  const queue = [...answers];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = queue.shift();
    if (answer === undefined) {
      throw new Error('the fake fetch has no answer left');
    }
    return Promise.resolve(
      new Response(answer.body ?? null, {
        status: answer.status,
        ...(answer.headers === undefined ? {} : { headers: answer.headers }),
      }),
    );
  });
  return calls;
}

function headersOf(call: Recorded | undefined): Headers {
  if (call === undefined) {
    throw new Error('no request was made');
  }
  return new Headers(call.init.headers);
}

function config(overrides: Partial<ApiClientConfig> = {}): ApiClientConfig {
  return {
    origin: ORIGIN,
    clientHeader: 'ios/1.4.0',
    getAuthorization: () => null,
    credentials: 'omit',
    onUnauthorized: vi.fn(),
    onUpgradeRequired: vi.fn(),
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('the call did not reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch before configuration', () => {
  it('refuses to run before it is configured', async () => {
    vi.resetModules();
    const fresh = await import('./mutator.ts');
    const calls = fakeFetch({ status: 200, body: '{}' });
    await expect(fresh.apiFetch('/v1/openapi.json', { method: 'GET' })).rejects.toThrow(
      'API client is not configured',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('apiFetch', () => {
  beforeEach(() => {
    configureApiClient(config());
  });

  it('sends the client header, credentials and origin', async () => {
    const calls = fakeFetch({ status: 200, body: '{"openapi":"3.1.0"}' });
    await expect(apiFetch('/v1/openapi.json', { method: 'GET' })).resolves.toEqual({
      openapi: '3.1.0',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.test/v1/openapi.json');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.method).toBe('GET');
    expect(headersOf(calls[0]).get('X-OS-Client')).toBe('ios/1.4.0');
    expect(headersOf(calls[0]).get('Accept')).toBe('application/json');
  });

  it('calls the same origin when the origin is empty', async () => {
    configureApiClient(
      config({ origin: '', clientHeader: 'web/1.4.0', credentials: 'same-origin' }),
    );
    const calls = fakeFetch({ status: 200, body: '{}' });
    await apiFetch('/v1/openapi.json', { method: 'GET' });
    expect(calls[0]?.url).toBe('/v1/openapi.json');
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(headersOf(calls[0]).get('X-OS-Client')).toBe('web/1.4.0');
  });

  it('refuses a path that does not start with exactly one /', async () => {
    for (const origin of [ORIGIN, '']) {
      configureApiClient(config({ origin }));
      const calls = fakeFetch();
      for (const path of [
        '//evil.example.test/v1/me',
        '/\\evil.example.test/v1/me',
        'v1/me',
        'https://evil.example.test/v1/me',
        '',
      ]) {
        await expect(apiFetch(path, { method: 'GET' }), `${origin} ${path}`).rejects.toThrow(
          'apiFetch takes a path that starts with exactly one /',
        );
      }
      expect(calls).toHaveLength(0);
    }
  });

  it('forwards keepalive', async () => {
    const calls = fakeFetch({ status: 204 });
    await apiFetch('/v1/client-errors', { method: 'POST', keepalive: true, body: '{}' });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.keepalive).toBe(true);
    expect(calls[0]?.init.body).toBe('{}');
  });

  it('forwards the abort signal and keeps the request headers', async () => {
    const controller = new AbortController();
    const calls = fakeFetch({ status: 200, body: '{}' });
    await apiFetch('/v1/openapi.json', {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(calls[0]?.init.signal).toBe(controller.signal);
    expect(headersOf(calls[0]).get('Content-Type')).toBe('application/json');
    expect(headersOf(calls[0]).get('X-OS-Client')).toBe('ios/1.4.0');
  });

  it('adds the bearer value when there is one', async () => {
    configureApiClient(config({ getAuthorization: () => 'Bearer abc' }));
    const withToken = fakeFetch({ status: 200, body: '{}' });
    await apiFetch('/v1/openapi.json', { method: 'GET' });
    expect(headersOf(withToken[0]).get('Authorization')).toBe('Bearer abc');

    configureApiClient(config({ getAuthorization: () => null }));
    const withoutToken = fakeFetch({ status: 200, body: '{}' });
    await apiFetch('/v1/openapi.json', { method: 'GET' });
    expect(headersOf(withoutToken[0]).has('Authorization')).toBe(false);
  });

  it('turns an envelope into ApiError', async () => {
    fakeFetch({ status: 400, body: envelope('invalid_request', { handle: 'too_short' }) });
    const error = await rejection(apiFetch('/v1/me', { method: 'PATCH', body: '{}' }));
    expect(error.code).toBe('invalid_request');
    expect(error.fields['handle']).toBe('too_short');
    expect(error.retryAfterSeconds).toBeNull();
  });

  it('calls the 401 and 426 callbacks', async () => {
    const onUnauthorized = vi.fn();
    const onUpgradeRequired = vi.fn();
    configureApiClient(config({ onUnauthorized, onUpgradeRequired }));

    fakeFetch({ status: 401, body: envelope('unauthenticated') });
    expect(await rejection(apiFetch('/v1/me', { method: 'GET' }))).toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUpgradeRequired).not.toHaveBeenCalled();

    fakeFetch({ status: 426, body: envelope('upgrade_required') });
    expect((await rejection(apiFetch('/v1/me', { method: 'GET' }))).code).toBe('upgrade_required');
    expect(onUpgradeRequired).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('maps an unreadable error body to internal', async () => {
    fakeFetch({
      status: 502,
      body: '<html><body>Bad gateway</body></html>',
      headers: { 'Content-Type': 'text/html' },
    });
    const error = await rejection(apiFetch('/v1/openapi.json', { method: 'GET' }));
    expect(error.code).toBe('internal');
    expect(error.fields).toEqual({});
  });

  it('maps a non-envelope 503 to unavailable', async () => {
    fakeFetch({ status: 503, body: '{ "db": "down", "worker": "unknown" }' });
    const error = await rejection(apiFetch('/v1/openapi.json', { method: 'GET' }));
    expect(error.code).toBe('unavailable');
  });

  it('keeps the code of an envelope on a 503', async () => {
    fakeFetch({ status: 503, body: envelope('rate_limited') });
    expect((await rejection(apiFetch('/v1/openapi.json', { method: 'GET' }))).code).toBe(
      'rate_limited',
    );
  });

  it('reads Retry-After', async () => {
    fakeFetch({ status: 429, body: envelope('rate_limited'), headers: { 'Retry-After': '12' } });
    const error = await rejection(apiFetch('/v1/openapi.json', { method: 'GET' }));
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(12);
  });

  it('ignores a Retry-After that is not whole seconds', async () => {
    fakeFetch({
      status: 429,
      body: envelope('rate_limited'),
      headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    });
    expect((await rejection(apiFetch('/v1/x', { method: 'GET' }))).retryAfterSeconds).toBeNull();
    fakeFetch({ status: 429, body: envelope('rate_limited'), headers: { 'Retry-After': '1.5' } });
    expect((await rejection(apiFetch('/v1/x', { method: 'GET' }))).retryAfterSeconds).toBeNull();
  });

  it('returns undefined for 204', async () => {
    fakeFetch({ status: 204 });
    await expect(apiFetch('/v1/me/blocks/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('rethrows a network failure unchanged', async () => {
    const failure = new TypeError('Network request failed');
    vi.stubGlobal('fetch', () => Promise.reject(failure));
    await expect(apiFetch('/v1/openapi.json', { method: 'GET' })).rejects.toBe(failure);
  });
});

describe('lastRequestId', () => {
  it('keeps the last request id', async () => {
    vi.resetModules();
    const fresh = await import('./mutator.ts');
    fresh.configureApiClient(config());
    expect(fresh.lastRequestId()).toBeNull();

    fakeFetch(
      { status: 200, body: '{}', headers: { 'X-Request-Id': 'a' } },
      { status: 404, body: envelope('not_found'), headers: { 'X-Request-Id': 'b' } },
      { status: 200, body: '{}' },
    );
    await fresh.apiFetch('/v1/openapi.json', { method: 'GET' });
    expect(fresh.lastRequestId()).toBe('a');

    await expect(fresh.apiFetch('/v1/nothing', { method: 'GET' })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(fresh.lastRequestId()).toBe('b');

    await fresh.apiFetch('/v1/openapi.json', { method: 'GET' });
    expect(fresh.lastRequestId()).toBeNull();
  });

  it('keeps the stored id when the network fails', async () => {
    vi.resetModules();
    const fresh = await import('./mutator.ts');
    fresh.configureApiClient(config());
    fakeFetch({ status: 200, body: '{}', headers: { 'X-Request-Id': 'a' } });
    await fresh.apiFetch('/v1/openapi.json', { method: 'GET' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Network request failed')));
    await expect(fresh.apiFetch('/v1/openapi.json', { method: 'GET' })).rejects.toThrow(
      'Network request failed',
    );
    expect(fresh.lastRequestId()).toBe('a');
  });
});
