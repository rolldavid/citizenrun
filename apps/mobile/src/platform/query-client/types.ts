import type { QueryClient } from '@tanstack/react-query';

import type { Unsubscribe } from '../shared';
export type { Unsubscribe } from '../shared';

export interface QueryClientModule {
  /** The one QueryClient. Made on the first call with the defaults; the same instance afterwards. */
  get(): QueryClient;
  /** Wires focus and network state into TanStack's managers. Called once at startup. Returns a function that unwires (tests only). */
  start(): Unsubscribe;
  /** Drops every cached query and mutation (logout and the other session ends). */
  clear(): void;
}
