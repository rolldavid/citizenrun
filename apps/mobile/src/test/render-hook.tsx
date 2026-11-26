import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { RenderHookResult } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';

import { queryClient } from '@/platform/query-client';

/** renderHook inside a QueryClientProvider holding the query-client fake's client of this test. */
export function renderHookWithClient<Result, Props>(
  hook: (props: Props) => Result,
  options?: { initialProps: Props },
): RenderHookResult<Result, Props> & { client: QueryClient } {
  const client = queryClient.get();
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const rendered =
    options === undefined
      ? renderHook(hook, { wrapper: Wrapper })
      : renderHook(hook, { wrapper: Wrapper, initialProps: options.initialProps });
  return Object.assign(rendered, { client });
}
