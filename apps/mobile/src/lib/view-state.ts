import type { ErrorCode } from '@citizenrun/shared';

export type ViewState<T> =
  | { status: 'loading' }
  | { status: 'error'; code: ErrorCode; onRetry: () => void }
  | { status: 'offline'; onRetry: () => void } // no cached data and no network
  | { status: 'ready'; data: T; refreshing: boolean; stale: boolean }; // stale: cached data shown while offline
