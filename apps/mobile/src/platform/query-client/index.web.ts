import type { QueryClient } from '@tanstack/react-query';

import { createAppQueryClient } from './defaults';
import type { QueryClientModule } from './types';

let client: QueryClient | null = null;

function get(): QueryClient {
  client ??= createAppQueryClient();
  return client;
}

export const queryClient: QueryClientModule = {
  get,
  // TanStack's own visibilitychange, online and offline listeners apply (D-179).
  start: () => () => undefined,
  clear: () => {
    get().clear();
  },
};

export type * from './types';
