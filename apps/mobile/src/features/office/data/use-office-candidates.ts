import type { CandidacyView } from '@citizenrun/shared';
import { useListOfficeCandidatesInfinite } from '@citizenrun/shared/api';
import type { InfiniteData } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

/** The page size of E-OFF-02, its largest. */
const PAGE_SIZE = 50;

/** A page of E-OFF-02 as its schema has it. */
type CandidacyPage = { items: readonly CandidacyView[]; nextCursor: string | null };

export type OfficeCandidates = {
  items: readonly CandidacyView[] | null;
  hasNextPage: boolean;
  isFetching: boolean;
  refetch: () => void;
};

/**
 * E-OFF-02, every page: once enabled it loads page after page until the last, so one press of
 * "Show all" shows every candidate. `items` is null until the first page arrives.
 */
export function useOfficeCandidates(officeId: string | null, enabled: boolean): OfficeCandidates {
  const active = enabled && officeId !== null;
  // Typed as the shared CandidacyView, the response's schema: the generated model marks the
  // candidacy's person as nullable, which the schema does not.
  const query = useListOfficeCandidatesInfinite<
    InfiniteData<CandidacyPage, string | undefined>,
    Error
  >(
    officeId ?? '',
    { limit: PAGE_SIZE },
    {
      query: {
        enabled: active,
        initialPageParam: undefined,
        getNextPageParam: (page) => page.nextCursor,
      },
    },
  );
  const { data, hasNextPage, isFetching, fetchNextPage, refetch } = query;

  useEffect(() => {
    if (active && hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [active, hasNextPage, isFetching, fetchNextPage]);

  const items = useMemo(() => {
    if (data === undefined) {
      return null;
    }
    const seen = new Set<string>();
    return data.pages
      .flatMap((page) => page.items)
      .filter((candidacy) => {
        if (seen.has(candidacy.id)) {
          return false;
        }
        seen.add(candidacy.id);
        return true;
      });
  }, [data]);

  return {
    items: active ? items : null,
    hasNextPage: active && hasNextPage,
    isFetching: active && isFetching,
    refetch: () => {
      if (active) {
        void refetch();
      }
    },
  };
}
