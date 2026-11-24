import { ApiError } from '@citizenrun/shared';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRetryable } from './defaults';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

type NetworkEvent = { isConnected?: boolean; isInternetReachable?: boolean | null };

const rn = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
  removed: 0,
}));

const net = vi.hoisted(() => ({
  listeners: new Set<
    (state: { isConnected?: boolean; isInternetReachable?: boolean | null }) => void
  >(),
  removed: 0,
  initial: (): Promise<{ isConnected?: boolean; isInternetReachable?: boolean | null }> =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_type: 'change', listener: (state: string) => void) => {
      rn.listeners.add(listener);
      return {
        remove: () => {
          rn.removed += 1;
          rn.listeners.delete(listener);
        },
      };
    },
  },
}));

vi.mock('expo-network', () => ({
  addNetworkStateListener: (listener: (state: NetworkEvent) => void) => {
    net.listeners.add(listener);
    return {
      remove: () => {
        net.removed += 1;
        net.listeners.delete(listener);
      },
    };
  },
  getNetworkStateAsync: () => net.initial(),
}));

const { queryClient } = await vi.importActual<typeof NativeIndex>('./index.native');
const { queryClient: webQueryClient } = await vi.importActual<typeof WebIndex>('./index.web');

function appState(state: string): void {
  for (const listener of [...rn.listeners]) {
    listener(state);
  }
}

function network(state: NetworkEvent): void {
  for (const listener of [...net.listeners]) {
    listener(state);
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  rn.listeners.clear();
  rn.removed = 0;
  net.listeners.clear();
  net.removed = 0;
  net.initial = () => Promise.resolve({ isConnected: true, isInternetReachable: true });
});

afterEach(() => {
  focusManager.setEventListener(() => undefined);
  focusManager.setFocused(undefined);
  onlineManager.setEventListener(() => undefined);
  onlineManager.setOnline(true);
});

describe('query client', () => {
  it('one client', () => {
    expect(queryClient.get()).toBe(queryClient.get());
    expect(webQueryClient.get()).toBe(webQueryClient.get());
  });

  it('the defaults are as written', () => {
    for (const module of [queryClient, webQueryClient]) {
      const { queries, mutations } = module.get().getDefaultOptions();
      expect(queries).toMatchObject({
        staleTime: 0,
        gcTime: 300_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: 'online',
      });
      expect(mutations).toMatchObject({ retry: 0, networkMode: 'online' });
      const retryDelay = queries?.retryDelay;
      if (typeof retryDelay !== 'function') {
        throw new Error('retryDelay is not a function');
      }
      const error = new TypeError('x');
      expect([1, 2, 3, 4].map((attempt) => retryDelay(attempt, error))).toEqual([
        2000, 4000, 8000, 8000,
      ]);
    }
  });

  it('retry rules', () => {
    expect(isRetryable(new TypeError('x'))).toBe(true);
    expect(isRetryable(new ApiError('unavailable'))).toBe(true);
    expect(isRetryable(new ApiError('rate_limited'))).toBe(false);
    expect(isRetryable(new ApiError('not_found'))).toBe(false);
    expect(isRetryable(new ApiError('internal'))).toBe(false);

    const retry = queryClient.get().getDefaultOptions().queries?.retry;
    if (typeof retry !== 'function') {
      throw new Error('retry is not a function');
    }
    expect(retry(0, new TypeError('x'))).toBe(true);
    expect(retry(1, new TypeError('x'))).toBe(true);
    expect(retry(2, new TypeError('x'))).toBe(false);
    expect(retry(0, new ApiError('rate_limited'))).toBe(false);
  });

  it('focus follows AppState on phones', () => {
    queryClient.start();
    appState('background');
    expect(focusManager.isFocused()).toBe(false);
    appState('active');
    expect(focusManager.isFocused()).toBe(true);
    appState('inactive');
    expect(focusManager.isFocused()).toBe(false);
  });

  it('online follows expo-network on phones', async () => {
    queryClient.start();
    await settle();
    network({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);
    network({ isConnected: true, isInternetReachable: null });
    expect(onlineManager.isOnline()).toBe(true);
    network({ isConnected: true, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('the initial network state applies when no event came first', async () => {
    net.initial = () => Promise.resolve({ isConnected: false, isInternetReachable: false });
    queryClient.start();
    await settle();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('an initial state that resolves after an event does not overwrite it', async () => {
    let answer: (state: NetworkEvent) => void = () => undefined;
    net.initial = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    queryClient.start();
    network({ isConnected: true, isInternetReachable: true });
    answer({ isConnected: false, isInternetReachable: false });
    await settle();
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('a failed initial state keeps the manager online', async () => {
    net.initial = () => Promise.reject(new Error('fixture'));
    queryClient.start();
    await settle();
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('unwiring removes the subscriptions', async () => {
    const unwire = queryClient.start();
    await settle();
    appState('active');
    expect(focusManager.isFocused()).toBe(true);
    unwire();
    unwire();
    expect(rn.removed).toBe(1);
    expect(net.removed).toBe(1);
    appState('background');
    network({ isConnected: false });
    expect(focusManager.isFocused()).toBe(true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('the web wires nothing', () => {
    const focusSpy = vi.spyOn(focusManager, 'setEventListener');
    const onlineSpy = vi.spyOn(onlineManager, 'setEventListener');
    const unwire = webQueryClient.start();
    expect(typeof unwire).toBe('function');
    unwire();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(onlineSpy).not.toHaveBeenCalled();
    expect(rn.listeners.size).toBe(0);
    expect(net.listeners.size).toBe(0);
  });

  it('clear empties both caches', async () => {
    for (const module of [queryClient, webQueryClient]) {
      const client = module.get();
      client.setQueryData(['fixture'], 1);
      await client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.resolve(1) })
        .execute(undefined);
      expect(client.getQueryCache().getAll()).toHaveLength(1);
      expect(client.getMutationCache().getAll()).toHaveLength(1);
      module.clear();
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(client.getMutationCache().getAll()).toHaveLength(0);
    }
  });
});
