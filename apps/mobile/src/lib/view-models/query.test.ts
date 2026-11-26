import { ApiError, apiFetch } from '@citizenrun/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import { queryClientFake } from '@/test/platform/query-client';

import {
  attempt,
  failureCode,
  querySource,
  readApiFailure,
  subscribeAppFocus,
  viewStateOf,
} from './query';
import type { QuerySource } from './query';

afterEach(() => {
  vi.unstubAllGlobals();
});

function source(
  status: QuerySource['status'],
  fetchStatus: QuerySource['fetchStatus'] = 'idle',
  error: unknown = null,
): QuerySource & { refetch: Mock<() => unknown> } {
  return { status, fetchStatus, error, refetch: vi.fn<() => unknown>() };
}

describe('readApiFailure', () => {
  it('reads an API refusal', () => {
    const error = new ApiError('rate_limited', {
      fields: { handle: 'required' },
      retryAfterSeconds: 30,
    });
    expect(readApiFailure(error)).toEqual({
      kind: 'api',
      code: 'rate_limited',
      status: 429,
      fields: { handle: 'required' },
      retryAfterSeconds: 30,
    });
  });

  it('reads the refusal the generated client throws, with its Retry-After', async () => {
    installApiStub([
      {
        method: 'GET',
        path: '/v1/me',
        reply: apiError(429, 'rate_limited', {
          fields: { handle: 'required' },
          retryAfterSeconds: 30,
        }),
      },
    ]);
    configureTestApiClient();
    const outcome = await attempt(() => apiFetch('/v1/me', { method: 'GET' }));
    expect(outcome).toEqual({
      ok: false,
      failure: {
        kind: 'api',
        code: 'rate_limited',
        status: 429,
        fields: { handle: 'required' },
        retryAfterSeconds: 30,
      },
    });
  });

  it('reads a network failure', () => {
    expect(readApiFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'network' });
  });

  it('reads an abort', () => {
    expect(readApiFailure(new DOMException('aborted', 'AbortError'))).toEqual({ kind: 'aborted' });
  });

  it('answers unavailable when no answer came', () => {
    expect(failureCode({ kind: 'network' })).toBe('unavailable');
    expect(failureCode({ kind: 'aborted' })).toBe('unavailable');
    expect(
      failureCode({
        kind: 'api',
        code: 'not_found',
        status: 404,
        fields: {},
        retryAfterSeconds: null,
      }),
    ).toBe('not_found');
  });
});

describe('attempt', () => {
  it('attempt answers a value or a failure', async () => {
    const stub = installApiStub([
      { method: 'POST', path: '/v1/me/consents', reply: json(200, { saved: true }) },
      { method: 'GET', path: '/v1/me', reply: { kind: 'network_error' } },
      { method: 'GET', path: '/v1/me/export', reply: { kind: 'hang' } },
    ]);
    configureTestApiClient();

    await expect(
      attempt(() => apiFetch('/v1/me/consents?x=1', { method: 'POST', body: '{"kind":"terms"}' })),
    ).resolves.toEqual({ ok: true, value: { saved: true } });
    await expect(attempt(() => apiFetch('/v1/me', { method: 'GET' }))).resolves.toEqual({
      ok: false,
      failure: { kind: 'network' },
    });

    const controller = new AbortController();
    const pending = attempt(() =>
      apiFetch('/v1/me/export', { method: 'GET', signal: controller.signal }),
    );
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, failure: { kind: 'aborted' } });

    expect(stub.requests).toEqual([
      {
        method: 'POST',
        path: '/v1/me/consents',
        query: { x: '1' },
        body: { kind: 'terms' },
        hasSignal: false,
      },
      { method: 'GET', path: '/v1/me', query: {}, body: null, hasSignal: false },
      { method: 'GET', path: '/v1/me/export', query: {}, body: null, hasSignal: true },
    ]);
  });
});

describe('viewStateOf', () => {
  it('maps queries to view states', () => {
    const data = (): string => 'data';

    expect(viewStateOf([source('success'), source('success')], data, true)).toEqual({
      status: 'ready',
      data: 'data',
      refreshing: false,
      stale: false,
    });
    expect(viewStateOf([source('success')], data, false)).toEqual({
      status: 'ready',
      data: 'data',
      refreshing: false,
      stale: true,
    });
    expect(viewStateOf([source('success', 'fetching'), source('success')], data, true)).toEqual({
      status: 'ready',
      data: 'data',
      refreshing: true,
      stale: false,
    });

    const healthy = source('success');
    const failed = source('error', 'idle', new ApiError('not_found'));
    const errored = viewStateOf([healthy, failed], data, true);
    expect(errored).toMatchObject({ status: 'error', code: 'not_found' });
    if (errored.status !== 'error') throw new Error('expected an error state');
    errored.onRetry();
    expect(failed.refetch).toHaveBeenCalledTimes(1);
    expect(healthy.refetch).not.toHaveBeenCalled();

    const paused = source('pending', 'paused');
    const offline = viewStateOf([paused, source('success')], data, true);
    expect(offline).toMatchObject({ status: 'offline' });
    expect(viewStateOf([source('pending', 'fetching')], data, false)).toMatchObject({
      status: 'offline',
    });

    expect(viewStateOf([source('pending', 'fetching')], data, true)).toEqual({
      status: 'loading',
    });
  });

  it('never builds the data before every source has it', () => {
    const ready = vi.fn(() => 'data');
    viewStateOf([source('success'), source('pending', 'fetching')], ready, true);
    expect(ready).not.toHaveBeenCalled();
  });

  it('retries every source from the offline state', () => {
    const first = source('pending', 'paused');
    const second = source('success');
    const state = viewStateOf([first, second], () => 'data', true);
    if (state.status !== 'offline') throw new Error('expected the offline state');
    state.onRetry();
    expect(first.refetch).toHaveBeenCalledTimes(1);
    expect(second.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('querySource', () => {
  it('keeps cached data ready when a background refetch fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let fail = false;
    const observer = new QueryObserver(client, {
      queryKey: ['query-source-test'],
      queryFn: () => (fail ? Promise.reject(new ApiError('internal')) : Promise.resolve('cached')),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await observer.refetch();
      const data = (): string => 'data';
      expect(viewStateOf([querySource(observer.getCurrentResult())], data, true)).toMatchObject({
        status: 'ready',
      });

      fail = true;
      await observer.refetch();
      const failed = observer.getCurrentResult();
      // TanStack v5 reports the failed refetch as an error while it keeps the data.
      expect(failed.status).toBe('error');
      expect(failed.data).toBe('cached');
      expect(viewStateOf([querySource(failed)], data, true)).toEqual({
        status: 'ready',
        data: 'data',
        refreshing: false,
        stale: false,
      });
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it('answers the error state when the first load fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, {
      queryKey: ['query-source-test-first'],
      queryFn: () => Promise.reject(new ApiError('internal')),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await observer.refetch();
      expect(
        viewStateOf([querySource(observer.getCurrentResult())], () => 'data', true),
      ).toMatchObject({ status: 'error', code: 'internal' });
    } finally {
      unsubscribe();
      client.clear();
    }
  });
});

describe('subscribeAppFocus', () => {
  it('calls back when the app regains focus', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppFocus(listener);
    queryClientFake.setFocused(true);
    expect(listener).toHaveBeenCalledTimes(1);
    queryClientFake.setFocused(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    queryClientFake.setFocused(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
