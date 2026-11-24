import { ApiError } from '@citizenrun/shared';
import { QueryClient } from '@tanstack/react-query';

export const QUERY_RETRY_LIMIT = 2; // PM-query-client
export const QUERY_RETRY_BASE_MS = 1_000; // PM-query-client
export const QUERY_RETRY_MAX_MS = 8_000; // PM-query-client
export const QUERY_GC_TIME_MS = 300_000; // TanStack's default, PM-query-client

/** True for a failure that is not an ApiError (the network failed) and for ApiError 'unavailable'. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === 'unavailable';
  }
  return true;
}

/** A QueryClient with PM-query-client's defaults. No persister: nothing is written to the device (D-195). */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: 'online',
        retry: (failureCount, error) => failureCount < QUERY_RETRY_LIMIT && isRetryable(error),
        retryDelay: (attempt) => Math.min(QUERY_RETRY_BASE_MS * 2 ** attempt, QUERY_RETRY_MAX_MS),
      },
      mutations: { retry: 0, networkMode: 'online' },
    },
  });
}
