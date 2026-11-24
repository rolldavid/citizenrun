import { useApiStatus } from '@/features/hello/data/use-api-status';

import { buildHelloViewModel } from './hello.build';
import type { HelloViewModel } from './hello.types';

/** SCR-hello's view-model: the API's readiness as a view state. */
export function useHelloViewModel(): HelloViewModel {
  const status = useApiStatus();
  return buildHelloViewModel(status, { onRetry: status.refetch, onRefresh: status.refetch });
}
