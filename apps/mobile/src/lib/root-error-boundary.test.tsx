import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { links } from '@/platform/links';
import { linksFake } from '@/test/platform/links';

import { reportClientError } from './client-errors';
import type * as ClientErrors from './client-errors';
import { RootErrorBoundary } from './root-error-boundary';
import type { RootErrorFallbackProps } from './root-error-boundary';

vi.mock('./client-errors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrors>();
  return { ...actual, reportClientError: vi.fn() };
});

class ChunkLoadError extends Error {
  override readonly name = 'ChunkLoadError';
}

const fixture: { toThrow: Error | null; retry: (() => void) | null } = {
  toThrow: null,
  retry: null,
};

function Thrower(): ReactElement {
  // React renders once more after a throw before it hands the error to the boundary, so this throws on every
  // render until a test clears the flag.
  if (fixture.toThrow !== null) {
    throw fixture.toThrow;
  }
  return <View testID="fixture.child" />;
}

function renderFallback({ onRetry }: RootErrorFallbackProps): ReactElement {
  fixture.retry = onRetry;
  return <View testID="fixture.fallback" />;
}

function renderBoundary(): void {
  render(
    <RootErrorBoundary route="/fixture" fallback={renderFallback}>
      <Thrower />
    </RootErrorBoundary>,
  );
}

function reloadCalls(): unknown[] {
  return linksFake.calls.filter((call) => call.op === 'reloadOnce');
}

beforeEach(() => {
  fixture.toThrow = null;
  fixture.retry = null;
  vi.mocked(reportClientError).mockReset();
  // React reports every caught render error on the console; the assertions below are on what rendered.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('RootErrorBoundary', () => {
  it('a render error is reported, then the fallback shows', () => {
    const error = new TypeError('x is undefined');
    fixture.toThrow = error;
    renderBoundary();

    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith(
      error,
      { route: '/fixture', component: 'Thrower' },
      'app.render_failed',
    );
    expect(screen.getByTestId('fixture.fallback')).toBeTruthy();
    expect(screen.queryByTestId('fixture.child')).toBeNull();
    expect(reloadCalls()).toEqual([]);
  });

  it('a chunk error reloads once', () => {
    linksFake.scriptReloadOnce('chunk_error', [true]);
    fixture.toThrow = new ChunkLoadError('Loading chunk 3 failed.');
    renderBoundary();

    expect(reloadCalls()).toEqual([{ op: 'reloadOnce', reason: 'chunk_error' }]);
    expect(screen.queryByTestId('fixture.fallback')).toBeNull();
    expect(screen.queryByTestId('fixture.child')).toBeNull();
    expect(reportClientError).toHaveBeenCalledTimes(1);
  });

  it('a chunk error that cannot reload shows the fallback', () => {
    linksFake.scriptReloadOnce('chunk_error', [false]);
    fixture.toThrow = new ChunkLoadError('Loading chunk 3 failed.');
    renderBoundary();

    expect(reloadCalls()).toEqual([{ op: 'reloadOnce', reason: 'chunk_error' }]);
    expect(screen.getByTestId('fixture.fallback')).toBeTruthy();
  });

  it('the report comes before the reload', () => {
    const reloadSpy = vi.spyOn(links, 'reloadOnce');
    fixture.toThrow = new ChunkLoadError('Loading chunk 3 failed.');
    renderBoundary();

    const reportOrder = vi.mocked(reportClientError).mock.invocationCallOrder[0];
    const reloadOrder = reloadSpy.mock.invocationCallOrder[0];
    expect(reportOrder).toBeDefined();
    expect(reloadOrder).toBeDefined();
    expect(reportOrder ?? Infinity).toBeLessThan(reloadOrder ?? -Infinity);
  });

  it('retry renders the children again', () => {
    fixture.toThrow = new TypeError('x is undefined');
    renderBoundary();
    expect(screen.getByTestId('fixture.fallback')).toBeTruthy();

    const retry = fixture.retry;
    expect(retry).not.toBeNull();
    fixture.toThrow = null;
    act(() => {
      retry?.();
    });
    expect(screen.getByTestId('fixture.child')).toBeTruthy();
    expect(screen.queryByTestId('fixture.fallback')).toBeNull();
  });
});
