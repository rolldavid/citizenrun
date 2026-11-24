import type { ReadyzResponse } from '@citizenrun/shared';
import { useGetReadyz } from '@citizenrun/shared/api';

export type ApiStatus = {
  data: ReadyzResponse | undefined;
  error: unknown;
  isPaused: boolean; // a fetch is waiting because the device is offline
  isRefetching: boolean;
  refetch: () => void;
};

/** E-WEB-02 through the generated readiness hook, with the query client's defaults (refetch on focus). */
export function useApiStatus(): ApiStatus {
  const query = useGetReadyz();
  return {
    data: query.data,
    error: query.error,
    isPaused: query.isPaused,
    isRefetching: query.isRefetching,
    refetch: () => {
      void query.refetch();
    },
  };
}
