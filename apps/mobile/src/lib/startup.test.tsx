import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { links } from '@/platform/links';
import { queryClient } from '@/platform/query-client';
import { session } from '@/platform/session';
import { PlatformError } from '@/platform/shared';
import { storage } from '@/platform/storage';
import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';

import type * as ClientErrors from './client-errors';

vi.mock('./client-errors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrors>();
  return { ...actual, reportClientError: vi.fn() };
});

/** A fresh startup store. A mocked module keeps the instance its factory first returned across
 *  vi.resetModules(), so every platform module is imported statically above, before the first reset, and the
 *  fresh startup module sees the same fakes as the control objects; the setup file resets them before each test. */
async function loadFresh() {
  vi.resetModules();
  const startup = await import('./startup');
  const { reportClientError } = await import('./client-errors');
  return { ...startup, reportClientError };
}

type Loaded = Awaited<ReturnType<typeof loadFresh>>;

async function bootedHook(loaded: Loaded) {
  const hook = renderHook(() => loaded.useStartup());
  await waitFor(() => {
    expect(hook.result.current.booted).toBe(true);
  });
  return hook;
}

function receivedCallbacks() {
  const callbacks = sessionFake.lastCallbacks();
  if (callbacks === null) {
    throw new Error('session.configure was not called');
  }
  return callbacks;
}

describe('useStartup', () => {
  it('the platform starts in order', async () => {
    const loaded = await loadFresh();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hydrate = vi.spyOn(storage, 'hydrate').mockImplementation(() => gate);
    const configure = vi.spyOn(session, 'configure');
    const get = vi.spyOn(queryClient, 'get');
    const start = vi.spyOn(queryClient, 'start');

    const { result } = renderHook(() => loaded.useStartup());
    await act(async () => {
      await Promise.resolve();
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(configure).not.toHaveBeenCalled();
    expect(result.current.booted).toBe(false);

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => {
      expect(result.current.booted).toBe(true);
    });
    expect(configure).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    const order = [hydrate, configure, get, start].map(
      (spy) => spy.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result.current.updateRequired).toBe(false);
  });

  it('the platform starts once', async () => {
    const loaded = await loadFresh();
    const hydrate = vi.spyOn(storage, 'hydrate');
    const first = await bootedHook(loaded);
    const second = await bootedHook(loaded);
    first.rerender();
    second.rerender();
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(sessionFake.calls).toEqual([{ op: 'configure' }]);
  });

  it('426 reloads the web page once', async () => {
    const loaded = await loadFresh();
    const { result } = await bootedHook(loaded);
    linksFake.scriptReloadOnce('upgrade_required', [true]);
    act(() => {
      receivedCallbacks().onUpgradeRequired();
    });
    expect(linksFake.calls).toContainEqual({ op: 'reloadOnce', reason: 'upgrade_required' });
    expect(result.current.updateRequired).toBe(false);
  });

  it('426 without a reload blocks', async () => {
    const loaded = await loadFresh();
    const { result } = await bootedHook(loaded);
    linksFake.scriptReloadOnce('upgrade_required', [false]);
    act(() => {
      receivedCallbacks().onUpgradeRequired();
    });
    expect(result.current.updateRequired).toBe(true);
    expect(result.current.booted).toBe(true);
  });

  it('a failed start still renders', async () => {
    const loaded = await loadFresh();
    vi.mocked(loaded.reportClientError).mockClear();
    const error = new PlatformError('session', 'session.no_origin');
    vi.spyOn(session, 'configure').mockImplementation(() => {
      throw error;
    });
    await bootedHook(loaded);
    expect(loaded.reportClientError).toHaveBeenCalledTimes(1);
    expect(loaded.reportClientError).toHaveBeenCalledWith(
      error,
      { route: null, component: null },
      'app.startup_failed',
    );
  });

  it('401 does nothing yet', async () => {
    const loaded = await loadFresh();
    const { result } = await bootedHook(loaded);
    const before = result.current;
    const callbacks = receivedCallbacks();
    const onUnauthorized = vi.spyOn(callbacks, 'onUnauthorized');
    act(() => {
      callbacks.onUnauthorized();
    });
    expect(onUnauthorized).toHaveReturnedWith(undefined);
    expect(result.current).toBe(before);
    expect(result.current).toEqual({ booted: true, updateRequired: false });
  });
});

describe('handleUpgradeRequired', () => {
  it('calls onBlocked only when the page cannot reload', async () => {
    const loaded = await loadFresh();
    const onBlocked = vi.fn();
    linksFake.scriptReloadOnce('upgrade_required', [true, false]);
    const reloadOnce = vi.spyOn(links, 'reloadOnce');
    loaded.handleUpgradeRequired(onBlocked);
    expect(reloadOnce).toHaveBeenCalledWith('upgrade_required');
    expect(onBlocked).not.toHaveBeenCalled();
    loaded.handleUpgradeRequired(onBlocked);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });
});
