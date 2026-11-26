import type { Issue } from '@citizenrun/shared';
import { useListIssues } from '@citizenrun/shared/api';

import { querySource } from '@/lib/view-models/query';
import type { QuerySource } from '@/lib/view-models/query';

/** E-REF-01: the issues as the API lists them, or null before the first answer. */
export function useIssues(): { issues: readonly Issue[] | null; source: QuerySource } {
  const query = useListIssues();
  return {
    issues: query.data?.items ?? null,
    source: querySource(query),
  };
}
