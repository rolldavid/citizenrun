import { assertNever } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ViewState } from './view-state';

function describeState(state: ViewState<number>): string {
  switch (state.status) {
    case 'loading':
      return 'loading';
    case 'error':
      return `error:${state.code}`;
    case 'offline':
      return 'offline';
    case 'ready':
      return `ready:${String(state.data)}`;
    default:
      return assertNever(state);
  }
}

describe('ViewState', () => {
  it('four states', () => {
    expectTypeOf<ViewState<number>['status']>().toEqualTypeOf<
      'loading' | 'error' | 'offline' | 'ready'
    >();
  });

  it('the ready state carries data and freshness', () => {
    expectTypeOf<Extract<ViewState<string>, { status: 'ready' }>>().toEqualTypeOf<{
      status: 'ready';
      data: string;
      refreshing: boolean;
      stale: boolean;
    }>();
  });

  it('the error state carries a registry code and a retry', () => {
    expectTypeOf<
      Extract<ViewState<string>, { status: 'error' }>['code']
    >().toEqualTypeOf<ErrorCode>();
    expectTypeOf<Extract<ViewState<string>, { status: 'error' }>['onRetry']>().toEqualTypeOf<
      () => void
    >();
  });

  it('a view can switch over every state', () => {
    const onRetry = (): void => undefined;
    const answers = [
      describeState({ status: 'loading' }),
      describeState({ status: 'error', code: 'internal', onRetry }),
      describeState({ status: 'offline', onRetry }),
      describeState({ status: 'ready', data: 7, refreshing: false, stale: true }),
    ];
    expect(answers).toEqual(['loading', 'error:internal', 'offline', 'ready:7']);
    expect(new Set(answers).size).toBe(4);
  });
});
