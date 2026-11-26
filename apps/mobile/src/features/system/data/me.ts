import type { ConsentState, Me } from '@citizenrun/shared';
import { getGetMeQueryKey, useGetMe } from '@citizenrun/shared/api';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { useSessionPresence } from '@/lib/session-state';
import type { QuerySource } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import { useBoot } from './system-state';

// E-ME-01
export function meQueryKey(): QueryKey {
  return getGetMeQueryKey();
}

/**
 * The one Me query. It asks once the platform has started and while a session may exist; the client is
 * the platform module's, so the root view-model may call it outside the query provider.
 */
export function useMe(): { me: Me | null; source: QuerySource } {
  const boot = useBoot();
  const presence = useSessionPresence();
  const query = useGetMe(
    { query: { enabled: boot === 'ready' && presence !== 'absent' } },
    queryClient.get(),
  );
  return {
    me: query.data ?? null,
    source: {
      status: query.status,
      fetchStatus: query.fetchStatus,
      error: query.error,
      refetch: query.refetch,
    },
  };
}

export function writeMeToCache(client: QueryClient, me: Me): void {
  client.setQueryData<Me>(meQueryKey(), me);
}

/** Replaces the cached Me's consents; leaves the cache alone when no Me is cached. */
export function writeConsentsToCache(client: QueryClient, consents: ConsentState): void {
  client.setQueryData<Me>(meQueryKey(), (cached) =>
    cached === undefined ? undefined : { ...cached, consents },
  );
}

export function readMeFromCache(client: QueryClient): Me | null {
  return client.getQueryData<Me>(meQueryKey()) ?? null;
}
