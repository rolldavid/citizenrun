import type { Issue, IssuePage } from '@citizenrun/shared';
import { useListIssues } from '@citizenrun/shared/api';
import type { UseQueryResult } from '@tanstack/react-query';

function itemsOf(page: IssuePage): readonly Issue[] {
  return page.items;
}

/** E-REF-01: every issue, for the names and tiles of the office page. */
export function useIssues(): UseQueryResult<readonly Issue[]> {
  return useListIssues<readonly Issue[], Error>({ query: { select: itemsOf } });
}
