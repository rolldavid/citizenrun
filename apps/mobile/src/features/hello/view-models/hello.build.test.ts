import { ApiError } from '@citizenrun/shared';
import type { ReadyzResponse } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { buildHelloViewModel } from './hello.build';
import type { HelloQuery } from './hello.build';

const onRetry = (): void => undefined;
const onRefresh = (): void => undefined;

const NOTHING: HelloQuery = {
  data: undefined,
  error: null,
  isPaused: false,
  isRefetching: false,
};

function build(patch: Partial<HelloQuery>) {
  return buildHelloViewModel({ ...NOTHING, ...patch }, { onRetry, onRefresh });
}

function answer(db: ReadyzResponse['db'], worker: ReadyzResponse['worker']): ReadyzResponse {
  return { db, worker };
}

describe('buildHelloViewModel', () => {
  it('a 200 with a running worker is ready', () => {
    expect(build({ data: answer('ok', 'ok') })).toEqual({
      status: 'ready',
      data: { worker: 'running', onRefresh },
      refreshing: false,
      stale: false,
    });
  });

  it('a 200 with a stale or unknown worker reads stale', () => {
    for (const worker of ['stale', 'unknown'] as const) {
      const vm = build({ data: answer('ok', worker) });
      expect(vm.status === 'ready' && vm.data.worker).toBe('stale');
    }
  });

  it('a refetch in flight is refreshing', () => {
    const vm = build({ data: answer('ok', 'ok'), isRefetching: true });
    expect(vm).toMatchObject({ status: 'ready', refreshing: true, stale: false });
  });

  it('a paused fetch over data is stale', () => {
    const vm = build({ data: answer('ok', 'ok'), isPaused: true });
    expect(vm).toMatchObject({ status: 'ready', refreshing: false, stale: true });
  });

  it('data wins over an error from a later refetch', () => {
    const vm = build({ data: answer('ok', 'stale'), error: new ApiError('internal') });
    expect(vm).toMatchObject({ status: 'ready', data: { worker: 'stale' } });
  });

  it('a down body is the unavailable error', () => {
    expect(build({ data: answer('down', 'unknown') })).toEqual({
      status: 'error',
      code: 'unavailable',
      onRetry,
    });
    expect(build({ data: answer('down', 'ok'), isPaused: true })).toMatchObject({
      status: 'error',
      code: 'unavailable',
    });
  });

  it('a paused first fetch is offline', () => {
    expect(build({ isPaused: true })).toEqual({ status: 'offline', onRetry });
    expect(build({ isPaused: true, error: new TypeError('Failed to fetch') })).toEqual({
      status: 'offline',
      onRetry,
    });
    expect(build({ isPaused: true, error: new ApiError('internal') })).toEqual({
      status: 'offline',
      onRetry,
    });
  });

  it('an ApiError keeps its code', () => {
    expect(build({ error: new ApiError('rate_limited') })).toEqual({
      status: 'error',
      code: 'rate_limited',
      onRetry,
    });
    expect(build({ error: new ApiError('unavailable') })).toMatchObject({
      status: 'error',
      code: 'unavailable',
    });
    expect(build({ error: new ApiError('internal') })).toMatchObject({
      status: 'error',
      code: 'internal',
    });
  });

  it('any other failure is unavailable', () => {
    for (const error of [new TypeError('Failed to fetch'), new Error('x')]) {
      expect(build({ error })).toEqual({ status: 'error', code: 'unavailable', onRetry });
    }
  });

  it('nothing yet is loading', () => {
    expect(build({})).toEqual({ status: 'loading' });
    expect(build({ error: undefined })).toEqual({ status: 'loading' });
    expect(build({ isRefetching: true })).toEqual({ status: 'loading' });
  });

  it('the callbacks are passed through', () => {
    const ready = build({ data: answer('ok', 'ok') });
    const error = build({ error: new Error('x') });
    const offline = build({ isPaused: true });
    expect(ready.status === 'ready' && ready.data.onRefresh).toBe(onRefresh);
    expect(error.status === 'error' && error.onRetry).toBe(onRetry);
    expect(offline.status === 'offline' && offline.onRetry).toBe(onRetry);
  });
});
