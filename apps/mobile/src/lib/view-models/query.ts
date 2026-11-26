import { ApiError } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import type { ViewState } from '@/lib/view-state';

export type ApiFailure =
  | {
      kind: 'api';
      code: ErrorCode;
      status: number;
      fields: Readonly<Record<string, string>>;
      retryAfterSeconds: number | null;
    }
  | { kind: 'network' }
  | { kind: 'aborted' };
export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/** Reads what went wrong with a request; never throws, never keeps the error object. */
export function readApiFailure(error: unknown): ApiFailure {
  if (error instanceof ApiError) {
    return {
      kind: 'api',
      code: error.code,
      status: error.status,
      fields: { ...error.fields },
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (isAbort(error)) {
    return { kind: 'aborted' };
  }
  return { kind: 'network' };
}

/** The code a view-model shows: the API's code, or 'unavailable' when the request never got an answer. */
export function failureCode(failure: ApiFailure): ErrorCode {
  return failure.kind === 'api' ? failure.code : 'unavailable';
}

/** Runs a request and answers its value or its failure. */
export async function attempt<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, failure: readApiFailure(error) };
  }
}

export type QuerySource = {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: unknown;
  refetch: () => unknown;
};

/** The fields of a TanStack query result that querySource reads. */
export type QueryResultLike = {
  data: unknown;
  status: QuerySource['status'];
  fetchStatus: QuerySource['fetchStatus'];
  error: unknown;
  refetch: () => unknown;
};

/**
 * A query's source for viewStateOf. A query that holds data counts as loaded: after a failed background
 * refetch TanStack v5 reports status 'error' while it keeps the cached data, and that data stays on
 * screen (00 section 8.4: `error` is the state with no data to show).
 */
export function querySource(query: QueryResultLike): QuerySource {
  return {
    status: query.data === undefined ? query.status : 'success',
    fetchStatus: query.fetchStatus,
    error: query.error,
    refetch: query.refetch,
  };
}

function refetchAll(sources: readonly QuerySource[]): void {
  for (const source of sources) {
    void source.refetch();
  }
}

/** Maps queries onto 00 section 8.4's ViewState; `ready` is called only when every source has data. */
export function viewStateOf<T>(
  sources: readonly QuerySource[],
  ready: () => T,
  online: boolean,
): ViewState<T> {
  if (sources.every((source) => source.status === 'success')) {
    return {
      status: 'ready',
      data: ready(),
      refreshing: sources.some((source) => source.fetchStatus === 'fetching'),
      stale: !online,
    };
  }
  const failed = sources.find((source) => source.status === 'error');
  if (failed !== undefined) {
    return {
      status: 'error',
      code: failureCode(readApiFailure(failed.error)),
      onRetry: () => {
        refetchAll(sources.filter((source) => source.status === 'error'));
      },
    };
  }
  const paused = sources.some(
    (source) => source.status === 'pending' && source.fetchStatus === 'paused',
  );
  if (paused || !online) {
    return {
      status: 'offline',
      onRetry: () => {
        refetchAll(sources);
      },
    };
  }
  return { status: 'loading' };
}

function subscribeOnline(listener: () => void): () => void {
  return onlineManager.subscribe(() => {
    listener();
  });
}

function isOnlineNow(): boolean {
  return onlineManager.isOnline();
}

function onlineOnServer(): boolean {
  return true;
}

/** True while TanStack's onlineManager reports a connection. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnlineNow, onlineOnServer);
}

/** Calls listener each time TanStack's focusManager reports the app focused; answers the unsubscribe. */
export function subscribeAppFocus(listener: () => void): () => void {
  return focusManager.subscribe((focused) => {
    if (focused) listener();
  });
}
