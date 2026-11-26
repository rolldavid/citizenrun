// The replacement for expo-router in tests:
// vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule)
import { useSyncExternalStore } from 'react';

export type RouterCall = { op: 'push' | 'replace' | 'back' | 'dismissTo'; path: string | null };

export const routerCalls: RouterCall[] = [];

type RouteState = {
  pathname: string;
  params: Record<string, string>;
  canGoBack: boolean;
  ready: boolean;
};

const DEFAULT_STATE: RouteState = { pathname: '/', params: {}, canGoBack: false, ready: true };

let state: RouteState = { ...DEFAULT_STATE, params: {} };
const listeners = new Set<() => void>();

function update(next: Partial<RouteState>): void {
  state = { ...state, ...next };
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function moveTo(path: string): void {
  const url = new URL(path, 'http://router.test');
  update({ pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()) });
}

export const routerModule: {
  router: {
    push(path: string): void;
    replace(path: string): void;
    back(): void;
    canGoBack(): boolean;
    dismissTo(path: string): void;
  };
  usePathname(): string;
  useGlobalSearchParams(): Record<string, string>;
  useLocalSearchParams(): Record<string, string>;
  useRootNavigationState(): { key: string | undefined };
} = {
  router: {
    push: (path) => {
      routerCalls.push({ op: 'push', path });
      moveTo(path);
    },
    replace: (path) => {
      routerCalls.push({ op: 'replace', path });
      moveTo(path);
    },
    back: () => {
      routerCalls.push({ op: 'back', path: null });
    },
    canGoBack: () => state.canGoBack,
    dismissTo: (path) => {
      routerCalls.push({ op: 'dismissTo', path });
      moveTo(path);
    },
  },
  usePathname: () => useSyncExternalStore(subscribe, () => state.pathname),
  useGlobalSearchParams: () => useSyncExternalStore(subscribe, () => state.params),
  useLocalSearchParams: () => useSyncExternalStore(subscribe, () => state.params),
  useRootNavigationState: () => {
    const ready = useSyncExternalStore(subscribe, () => state.ready);
    return { key: ready ? 'root' : undefined };
  },
};

/** Moves the current route; mounted hooks re-render. */
export function setRoute(pathname: string, params: Record<string, string> = {}): void {
  update({ pathname, params: { ...params } });
}

export function setCanGoBack(value: boolean): void {
  update({ canGoBack: value });
}

export function setNavigatorReady(ready: boolean): void {
  update({ ready });
}

/** Empties routerCalls and restores the route `/`, no history and a ready navigator. */
export function resetRouterMock(): void {
  routerCalls.length = 0;
  update({ ...DEFAULT_STATE, params: {} });
}
