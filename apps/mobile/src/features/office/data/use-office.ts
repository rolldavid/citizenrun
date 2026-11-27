import { isIssueId } from '@citizenrun/shared';
import type { OfficeDetail } from '@citizenrun/shared';
import { useGetOffice } from '@citizenrun/shared/api';
import { keepPreviousData } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * E-OFF-01 by slug. In single-issue mode the chosen issue rides in the query, and the page already
 * shown stays on screen while that refetch runs.
 */
export function useOffice(slug: string, issueId: string | null): UseQueryResult<OfficeDetail> {
  const params = issueId !== null && isIssueId(issueId) ? { issue: issueId } : undefined;
  // The data is typed as the shared OfficeDetail, the response's schema: the generated model marks
  // every PersonSummary it holds as nullable, which the schema does not.
  return useGetOffice<OfficeDetail, Error>(slug, params, {
    query: { placeholderData: keepPreviousData },
  });
}
