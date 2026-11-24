import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';

import type { QueryClientModule } from '@/platform/query-client/types';

export type QueryClientFakeCall = { op: 'clear' };

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

const calls: QueryClientFakeCall[] = [];
const state = { client: createTestClient() };

export const queryClient: QueryClientModule = {
  get: () => state.client,
  start: () => () => undefined,
  clear: () => {
    calls.push({ op: 'clear' });
    state.client.clear();
  },
};

export const queryClientFake = {
  calls: calls as readonly QueryClientFakeCall[],
  setOnline: (value: boolean): void => {
    onlineManager.setOnline(value);
  },
  setFocused: (value: boolean): void => {
    focusManager.setFocused(value);
  },
  /** A new client for the next test; TanStack's managers are singletons, so they are restored too. */
  reset: (): void => {
    calls.length = 0;
    state.client.clear();
    state.client = createTestClient();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  },
};
