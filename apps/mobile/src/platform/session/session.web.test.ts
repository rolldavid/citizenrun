import * as shared from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { auth } from '@/platform/auth';
import { queryClient } from '@/platform/query-client';
import { PlatformNotReadyError } from '@/platform/shared';
import { storage } from '@/platform/storage';
import { authFake } from '@/test/platform/auth';
import { queryClientFake } from '@/test/platform/query-client';
import { storageFake } from '@/test/platform/storage';

import type * as WebIndex from './index.web';

const constants = vi.hoisted(() => ({ expoConfig: { version: '0.1.0' } }));
// The web file must never reach the device store: any call fails the case.
const secure = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-constants', () => ({ default: constants }));
vi.mock('expo-secure-store', () => secure);
vi.mock('@citizenrun/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof shared>();
  return { ...actual, configureApiClient: vi.fn(actual.configureApiClient) };
});

const { session } = await vi.importActual<typeof WebIndex>('./index.web');

function callOrder(spy: MockInstance): number {
  const order = spy.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error('the step was not called');
  }
  return order;
}

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method),
  );
});

afterEach(() => {
  const logged = consoleSpies.filter((spy) => spy.mock.calls.length > 0).length;
  vi.restoreAllMocks();
  expect(logged).toBe(0);
});

describe('session on the web', () => {
  it('web', async () => {
    session.configure({ onUnauthorized: vi.fn(), onUpgradeRequired: vi.fn() });
    const options = vi.mocked(shared.configureApiClient).mock.calls[0]?.[0];
    expect(options?.credentials).toBe('same-origin');

    expect(await session.hydrate()).toBe('unknown');
    await expect(
      session.adopt({ token: 'fixtureToken-' + 'x'.repeat(30), expiresAt: '2026-12-25T00:00:00.000Z' }),
    ).resolves.toBeUndefined();
    expect(options?.getAuthorization()).toBeNull();
    expect(storageFake.calls).toEqual([]);

    const clearUserData = vi.spyOn(storage, 'clearUserData');
    const clear = vi.spyOn(queryClient, 'clear');
    const clearProviderState = vi.spyOn(auth, 'clearProviderState');
    await expect(session.endLocal('unauthorized')).resolves.toBeUndefined();
    expect(storageFake.calls).toEqual([{ op: 'clearUserData' }]);
    expect(queryClientFake.calls).toEqual([{ op: 'clear' }]);
    expect(authFake.calls).toEqual([{ op: 'clearProviderState' }]);
    expect(callOrder(clearUserData)).toBeLessThan(callOrder(clear));
    expect(callOrder(clear)).toBeLessThan(callOrder(clearProviderState));
    expect(options?.getAuthorization()).toBeNull();

    expect(secure.getItemAsync).not.toHaveBeenCalled();
    expect(secure.setItemAsync).not.toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('web endLocal survives a failing step', async () => {
    vi.spyOn(storage, 'clearUserData').mockImplementation(() => {
      throw new Error('fixture storage failure');
    });
    const clearProviderState = vi
      .spyOn(auth, 'clearProviderState')
      .mockRejectedValue(new PlatformNotReadyError('auth', 'clearProviderState'));
    await expect(session.endLocal('logout')).resolves.toBeUndefined();
    expect(queryClientFake.calls).toEqual([{ op: 'clear' }]);
    expect(clearProviderState).toHaveBeenCalledTimes(1);
  });
});
