import type { PersonDetail } from '@citizenrun/shared';
import { useGetPerson } from '@citizenrun/shared/api';
import type { UseQueryResult } from '@tanstack/react-query';

/** E-PPL-01 by slug. For a merged person the answer is the surviving person's detail. */
export function usePerson(slug: string): UseQueryResult<PersonDetail> {
  // The data is typed as the shared PersonDetail, the response's schema: the generated model marks
  // values as nullable that the schema does not.
  return useGetPerson<PersonDetail, Error>(slug);
}
