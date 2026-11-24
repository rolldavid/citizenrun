import { ApiError } from '@citizenrun/shared';

import type { ApiStatus } from '@/features/hello/data/use-api-status';

import type { HelloViewModel } from './hello.types';

export type HelloQuery = Pick<ApiStatus, 'data' | 'error' | 'isPaused' | 'isRefetching'>;

/** The hello screen's state from the readiness query; the first matching rule wins. */
export function buildHelloViewModel(
  query: HelloQuery,
  actions: { onRetry: () => void; onRefresh: () => void },
): HelloViewModel {
  const { data, error, isPaused, isRefetching } = query;
  if (data !== undefined && data.db === 'ok') {
    return {
      status: 'ready',
      data: { worker: data.worker === 'ok' ? 'running' : 'stale', onRefresh: actions.onRefresh },
      refreshing: isRefetching,
      stale: isPaused,
    };
  }
  if (data !== undefined && data.db === 'down') {
    return { status: 'error', code: 'unavailable', onRetry: actions.onRetry };
  }
  if (isPaused) {
    return { status: 'offline', onRetry: actions.onRetry };
  }
  if (error !== null && error !== undefined) {
    // apiFetch throws every answer that is not 2xx as ApiError, the 503 down body as `unavailable`;
    // a network failure is not an ApiError and reads `unavailable`.
    const code = error instanceof ApiError ? error.code : 'unavailable';
    return { status: 'error', code, onRetry: actions.onRetry };
  }
  return { status: 'loading' };
}
