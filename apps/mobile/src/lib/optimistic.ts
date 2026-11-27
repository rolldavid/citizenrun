import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryFilters, QueryKey } from '@tanstack/react-query';

import { reportOptimisticFailure } from '@/lib/optimistic-failures';
import type { OptimisticAction } from '@/lib/optimistic-failures';
import { failureCode, readApiFailure } from '@/lib/view-models/query';

export type CachePlace = { filters: QueryFilters; patch: (data: unknown) => unknown };
export type OptimisticToggleOptions<V> = {
  mutationFn: (vars: V) => Promise<unknown>;
  action: (vars: V) => OptimisticAction;
  places: (vars: V) => readonly CachePlace[];
  invalidate: (vars: V) => readonly QueryFilters[];
};

/** Every cached value the patch is about to change, as it was before. */
type Snapshot = readonly (readonly [QueryKey, unknown])[];

/** The one helper for optimistic toggles: patch at once, put back on failure, re-read when settled. */
export function useOptimisticToggle<V>(options: OptimisticToggleOptions<V>): {
  toggle: (vars: V) => void;
  pending: boolean;
} {
  const client = useQueryClient();
  const mutation = useMutation<unknown, unknown, V, Snapshot>({
    // An offline press reaches fetch and fails at once, so the toggle is put back with its toast;
    // under the client's 'online' mode the mutation would pause with the toggle still flipped.
    networkMode: 'always',
    retry: 0,
    mutationFn: options.mutationFn,
    onMutate: async (vars) => {
      const places = options.places(vars);
      await Promise.all(places.map((place) => client.cancelQueries(place.filters)));
      const snapshot = places.flatMap((place) => client.getQueriesData(place.filters));
      for (const place of places) {
        client.setQueriesData(place.filters, place.patch);
      }
      return snapshot;
    },
    onError: (error, vars, snapshot) => {
      for (const [key, data] of snapshot ?? []) {
        client.setQueryData(key, data);
      }
      reportOptimisticFailure({
        action: options.action(vars),
        code: failureCode(readApiFailure(error)),
      });
    },
    onSettled: (_data, _error, vars) => {
      for (const filters of options.invalidate(vars)) {
        void client.invalidateQueries(filters);
      }
    },
  });
  return {
    toggle: (vars) => {
      mutation.mutate(vars);
    },
    pending: mutation.isPending,
  };
}
