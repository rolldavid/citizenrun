import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { links } from '@/platform/links';
import '@/platform/query-client';
import '@/platform/session';
import { storage } from '@/platform/storage';
import { linksFake } from '@/test/platform/links';
import { queryClientFake } from '@/test/platform/query-client';
import { sessionFake } from '@/test/platform/session';
import { storageFake } from '@/test/platform/storage';

type RouterCall =
  | { op: 'push'; href: string }
  | { op: 'navigate'; href: string }
  | { op: 'canDismiss' }
  | { op: 'dismissAll' };

const routerDouble = vi.hoisted(() => ({
  pathname: '/',
  canDismiss: false,
  calls: [] as RouterCall[],
}));

vi.mock('expo-router', () => ({
  usePathname: () => routerDouble.pathname,
  router: {
    push: (href: string) => {
      routerDouble.calls.push({ op: 'push', href });
    },
    navigate: (href: string) => {
      routerDouble.calls.push({ op: 'navigate', href });
    },
    canDismiss: () => {
      routerDouble.calls.push({ op: 'canDismiss' });
      return routerDouble.canDismiss;
    },
    dismissAll: () => {
      routerDouble.calls.push({ op: 'dismissAll' });
    },
  },
}));

const splash = vi.hoisted(() => ({ hidden: 0 }));

vi.mock('expo-splash-screen', () => ({
  hideAsync: () => {
    splash.hidden += 1;
    return Promise.resolve();
  },
}));

/** A fresh startup store under a fresh hook. A mocked module keeps the instance its factory first returned
 *  across vi.resetModules(), so every platform module the hook reaches is imported statically above, before the
 *  first reset, and the fresh modules see the same fakes as the controls; the setup file resets them before each
 *  test. */
async function loadFresh() {
  vi.resetModules();
  routerDouble.pathname = '/';
  routerDouble.canDismiss = false;
  routerDouble.calls.length = 0;
  splash.hidden = 0;
  const { useRootViewModel } = await import('./use-root-view-model');
  const { FONT_FACES } = await import('@/ui/fonts');
  return { useRootViewModel, FONT_FACES };
}

type Loaded = Awaited<ReturnType<typeof loadFresh>>;

async function readyHook(loaded: Loaded) {
  const hook = renderHook(() => loaded.useRootViewModel());
  await waitFor(() => {
    expect(hook.result.current.boot).toBe('ready');
  });
  return hook;
}

/** Lets pending promise callbacks (the fonts answer) run inside act. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useRootViewModel', () => {
  it('boot follows the platform start', async () => {
    const loaded = await loadFresh();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(storage, 'hydrate').mockImplementation(() => gate);

    const { result } = renderHook(() => loaded.useRootViewModel());
    await settle();
    expect(result.current.boot).toBe('starting');
    expect(result.current.themeChoice).toBe('system');
    expect(splash.hidden).toBe(0);

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => {
      expect(result.current.boot).toBe('ready');
    });
    expect(splash.hidden).toBe(1);
  });

  it('reads the theme from storage', async () => {
    const loaded = await loadFresh();
    storageFake.seed({ theme: 'light' });
    const { result } = await readyHook(loaded);
    expect(result.current.themeChoice).toBe('light');
  });

  it('follows the system theme when none is stored', async () => {
    const loaded = await loadFresh();
    const { result } = await readyHook(loaded);
    expect(result.current.themeChoice).toBe('system');
  });

  it('takes the fonts-ready answer', async () => {
    const loaded = await loadFresh();
    const fontsReady = vi.spyOn(links, 'fontsReady');
    const { result } = await readyHook(loaded);
    await waitFor(() => {
      expect(result.current.fontsReady).toBe(true);
    });
    expect(fontsReady).toHaveBeenCalledTimes(1);
    expect(fontsReady.mock.calls[0]?.[0]).toBe(loaded.FONT_FACES);
  });

  it('keeps fonts not ready on a false answer', async () => {
    const loaded = await loadFresh();
    linksFake.scriptFontsReady(false);
    const fontsReady = vi.spyOn(links, 'fontsReady');
    const { result } = await readyHook(loaded);
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(1);
    expect(result.current.fontsReady).toBe(false);
  });

  it('asks again for the fonts when the network comes back', async () => {
    const loaded = await loadFresh();
    linksFake.scriptFontsReady(false);
    const fontsReady = vi.spyOn(links, 'fontsReady');
    const { result } = await readyHook(loaded);
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(1);

    act(() => {
      queryClientFake.setOnline(false);
    });
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(1);

    act(() => {
      queryClientFake.setOnline(true);
    });
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(2);
    expect(result.current.fontsReady).toBe(false);

    linksFake.scriptFontsReady(true);
    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      queryClientFake.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.fontsReady).toBe(true);
    });
    expect(fontsReady).toHaveBeenCalledTimes(3);

    // A true answer ends the subscription.
    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      queryClientFake.setOnline(true);
    });
    await settle();
    expect(fontsReady).toHaveBeenCalledTimes(3);
  });

  it('shows the update screen when an upgrade is blocked', async () => {
    const loaded = await loadFresh();
    const { result } = await readyHook(loaded);
    expect(result.current.system).toBeNull();
    expect(result.current.shell.mode).toBe('app');

    linksFake.scriptReloadOnce('upgrade_required', [false]);
    const callbacks = sessionFake.lastCallbacks();
    expect(callbacks).not.toBeNull();
    act(() => {
      callbacks?.onUpgradeRequired();
    });
    expect(result.current.system).toBe('update');
    expect(result.current.shell.mode).toBe('bare');
    expect(result.current.shell.active).toBeNull();
  });

  it('gives the shell the route and the signed-out values', async () => {
    const loaded = await loadFresh();
    const { result, rerender } = await readyHook(loaded);
    expect(result.current.shell).toEqual({
      mode: 'app',
      active: 'home',
      unread: { messages: 0, activity: 0 },
      place: null,
      signedIn: false,
    });
    routerDouble.pathname = '/no-such-page';
    rerender();
    expect(result.current.shell.mode).toBe('bare');
    expect(result.current.shell.active).toBeNull();
  });

  it('navigates through the router', async () => {
    const loaded = await loadFresh();
    const { result } = await readyHook(loaded);

    result.current.onNavigate('explore');
    expect(routerDouble.calls).toEqual([{ op: 'push', href: '/sign-in?next=%2Fexplore' }]);

    routerDouble.calls.length = 0;
    result.current.onNavigate('home');
    expect(routerDouble.calls).toEqual([{ op: 'navigate', href: '/' }]);

    routerDouble.calls.length = 0;
    routerDouble.canDismiss = false;
    result.current.onReselect('home');
    expect(routerDouble.calls).toEqual([{ op: 'canDismiss' }]);

    routerDouble.calls.length = 0;
    routerDouble.canDismiss = true;
    result.current.onReselect('home');
    expect(routerDouble.calls).toEqual([{ op: 'canDismiss' }, { op: 'dismissAll' }]);
  });
});
