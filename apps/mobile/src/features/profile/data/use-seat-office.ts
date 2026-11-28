import type { OfficeDetail } from '@citizenrun/shared';
import { useGetOffice } from '@citizenrun/shared/api';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * E-OFF-01 for the office of a person's current seat, read only for whether the office is
 * partisan. It shares the office page's query key, so a page already visited answers from the
 * cache. With no slug nothing is requested.
 */
export function useSeatOffice(officeSlug: string | null): UseQueryResult<OfficeDetail> {
  // The data is typed as the shared OfficeDetail, the response's schema.
  return useGetOffice<OfficeDetail, Error>(officeSlug ?? '', undefined, {
    query: { enabled: officeSlug !== null },
  });
}
