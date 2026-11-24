import type { HelloViewModel } from './hello.types';

type HelloReady = Extract<HelloViewModel, { status: 'ready' }>;

export const helloLoading: HelloViewModel = { status: 'loading' };

export const helloReady: HelloReady = {
  status: 'ready',
  data: { worker: 'running', onRefresh: () => undefined },
  refreshing: false,
  stale: false,
};

export const helloWorkerStale: HelloViewModel = {
  ...helloReady,
  data: { worker: 'stale', onRefresh: () => undefined },
};

export const helloRefreshing: HelloViewModel = { ...helloReady, refreshing: true };

export const helloStale: HelloViewModel = { ...helloReady, stale: true };

export const helloError: HelloViewModel = {
  status: 'error',
  code: 'unavailable',
  onRetry: () => undefined,
};

export const helloOffline: HelloViewModel = { status: 'offline', onRetry: () => undefined };
