import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  markNavigationReady,
  peekRememberedNext,
  rememberNext,
  resetNavigationState,
  trackCurrentPath,
} from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence } from '@/lib/session-state';
import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { handleUnauthorized, handleUpgradeRequired } from './session-events';
import { isUpgradeBlocked, resetSystemState } from './system-state';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

beforeEach(() => {
  markNavigationReady();
});

afterEach(() => {
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
  resetSystemState();
});

function endLocalCalls() {
  return sessionFake.calls.filter((call) => call.op === 'endLocal');
}

describe('handleUnauthorized', () => {
  it('a 401 ends the local session and opens sign-in from a session route', async () => {
    trackCurrentPath('/settings/export');
    rememberNext('/settings');
    expect(peekRememberedNext()).toBe('/settings');

    await handleUnauthorized();

    expect(getSessionPresence()).toBe('absent');
    expect(endLocalCalls()).toEqual([{ op: 'endLocal', reason: 'unauthorized' }]);
    expect(peekRememberedNext()).toBeNull();
    expect(routerCalls).toEqual([{ op: 'replace', path: '/sign-in?next=%2Fsettings%2Fexport' }]);
  });

  it('a 401 on a public or sign-in route ends the session and stays', async () => {
    for (const path of ['/', '/sign-in']) {
      trackCurrentPath(path);
      await handleUnauthorized();
    }
    expect(endLocalCalls()).toEqual([
      { op: 'endLocal', reason: 'unauthorized' },
      { op: 'endLocal', reason: 'unauthorized' },
    ]);
    expect(routerCalls).toEqual([]);
  });

  it('a 401 on a development route ends the session and stays', async () => {
    trackCurrentPath('/dev/list-spike');
    await handleUnauthorized();
    expect(endLocalCalls()).toEqual([{ op: 'endLocal', reason: 'unauthorized' }]);
    expect(routerCalls).toEqual([]);
  });

  it('two 401s at once end the session once', async () => {
    trackCurrentPath('/settings');
    const first = handleUnauthorized();
    const second = handleUnauthorized();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(endLocalCalls()).toHaveLength(1);
    expect(routerCalls).toEqual([{ op: 'replace', path: '/sign-in?next=%2Fsettings' }]);
  });

  it('ends the session before it navigates', async () => {
    trackCurrentPath('/settings');
    let presenceAtEnd: string | null = null;
    let routerCallsAtEnd = -1;
    const { session } = await import('@/platform/session');
    vi.spyOn(session, 'endLocal').mockImplementation(() => {
      presenceAtEnd = getSessionPresence();
      routerCallsAtEnd = routerCalls.length;
      return Promise.resolve();
    });
    await handleUnauthorized();
    expect(presenceAtEnd).toBe('absent');
    expect(routerCallsAtEnd).toBe(0);
    expect(routerCalls).toHaveLength(1);
  });
});

describe('handleUpgradeRequired', () => {
  it('a refused upgrade shows the update screen after the one reload', () => {
    linksFake.scriptReloadOnce('upgrade_required', [true, false]);
    handleUpgradeRequired();
    expect(isUpgradeBlocked()).toBe(false);
    handleUpgradeRequired();
    expect(isUpgradeBlocked()).toBe(true);
  });

  it('the first 426 on the web reloads and shows nothing', () => {
    linksFake.scriptReloadOnce('upgrade_required', [true]);
    handleUpgradeRequired();
    expect(isUpgradeBlocked()).toBe(false);
  });

  it('a 426 that cannot reload shows the update screen', () => {
    linksFake.scriptReloadOnce('upgrade_required', [false]);
    handleUpgradeRequired();
    expect(isUpgradeBlocked()).toBe(true);
  });

  it('asks for the upgrade reason', () => {
    handleUpgradeRequired();
    expect(linksFake.calls).toContainEqual({ op: 'reloadOnce', reason: 'upgrade_required' });
  });
});
