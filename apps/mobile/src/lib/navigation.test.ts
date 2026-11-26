import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetSessionPresence } from '@/lib/session-state';
import { resetRouterMock, routerCalls, setCanGoBack } from '@/test/router-mock';
import { storageFake } from '@/test/platform/storage';

import {
  activeItemFor,
  clearRememberedNext,
  dismissTo,
  goBack,
  isAtLocation,
  isNavigationReady,
  markNavigationReady,
  navigateTo,
  navTargetFor,
  nextPathOf,
  peekRememberedNext,
  rememberNext,
  rememberTabItem,
  replaceWith,
  resetNavigationState,
  resolveGuard,
  safeInternalPath,
  shellModeFor,
} from './navigation';
import type { GuardInput, GuardResult, GuardSession, NavItemId } from './navigation';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

afterEach(() => {
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

const BASE: GuardInput = {
  path: '/',
  next: null,
  rememberedNext: null,
  session: { kind: 'none' },
  upgradeBlocked: false,
  ageGateBlocked: false,
  landingPageSupported: false,
  revealShowing: false,
  breakpoint: 'compact',
  devRoutesAllowed: true,
};

function guard(changes: Partial<GuardInput>): GuardResult {
  return resolveGuard({ ...BASE, ...changes });
}

function ready(
  onboardingStep: Extract<GuardSession, { kind: 'ready' }>['onboardingStep'],
  role: 'user' | 'admin' = 'user',
): GuardSession {
  return { kind: 'ready', onboardingStep, role };
}

const STAY: GuardResult = { kind: 'stay' };
const to = (path: string): GuardResult => ({ kind: 'redirect', to: path });

describe('safeInternalPath and next', () => {
  it('keeps an internal path', () => {
    expect(safeInternalPath('/settings/export')).toBe('/settings/export');
  });

  it('answers / for empty, relative and outside paths', () => {
    for (const path of [
      null,
      '',
      'settings',
      '//evil.example/x',
      '/\\evil.example',
      'https://evil.example/',
    ]) {
      expect(safeInternalPath(path), String(path)).toBe('/');
    }
  });

  it('reads next as a path alone', () => {
    expect(nextPathOf('/settings/export?x=1#y')).toBe('/settings/export');
    expect(nextPathOf(null)).toBeNull();
    expect(nextPathOf('')).toBeNull();
  });

  it('never follows next into sign-in or onboarding', () => {
    for (const raw of ['/sign-in', '/welcome', '/onboarding/handle']) {
      expect(nextPathOf(raw), raw).toBeNull();
    }
  });
});

describe('resolveGuard', () => {
  it('lets a development route through whatever the session', () => {
    expect(guard({ path: '/dev/gallery', session: ready('photo') })).toEqual(STAY);
  });

  it('sends a development route to / in a production build', () => {
    expect(
      guard({ path: '/dev/gallery', devRoutesAllowed: false, session: ready('done') }),
    ).toEqual(to('/'));
    expect(guard({ path: '/dev/gallery', devRoutesAllowed: false })).toEqual(to('/'));
  });

  it('shows the update screen first', () => {
    expect(guard({ upgradeBlocked: true, ageGateBlocked: true, path: '/welcome' })).toEqual({
      kind: 'system',
      screen: 'update',
    });
  });

  it('shows the adults-only screen on sign-in and onboarding paths while the gate is locked', () => {
    const adultsOnly: GuardResult = { kind: 'system', screen: 'adultsOnly' };
    expect(guard({ ageGateBlocked: true, path: '/sign-in' })).toEqual(adultsOnly);
    expect(
      guard({ ageGateBlocked: true, path: '/onboarding/photo', session: ready('photo') }),
    ).toEqual(adultsOnly);
    expect(guard({ ageGateBlocked: true, path: '/' })).toEqual(to('/welcome'));
  });

  it('sends a visitor with no session from / to the welcome screen where there is no landing page', () => {
    expect(guard({ path: '/' })).toEqual(to('/welcome'));
    expect(guard({ path: '/', next: '/settings/export' })).toEqual(
      to('/welcome?next=%2Fsettings%2Fexport'),
    );
  });

  it('keeps a visitor with no session on / where a landing page exists', () => {
    expect(guard({ path: '/', landingPageSupported: true })).toEqual(STAY);
  });

  it('lets a visitor with no session read public and sign-in pages', () => {
    for (const path of ['/office/fixture-office', '/welcome', '/sign-in']) {
      expect(guard({ path }), path).toEqual(STAY);
    }
  });

  it('sends a visitor with no session from onboarding to the welcome screen', () => {
    expect(guard({ path: '/onboarding/issues' })).toEqual(to('/welcome'));
  });

  it('sends a visitor with no session from a session route to sign-in with next', () => {
    expect(guard({ path: '/settings/export' })).toEqual(to('/sign-in?next=%2Fsettings%2Fexport'));
  });

  it('waits while the account is loading', () => {
    for (const path of ['/settings', '/onboarding/handle']) {
      expect(guard({ path, session: { kind: 'pending' } }), path).toEqual(STAY);
    }
  });

  it('sends a person mid-onboarding from any other path to their step', () => {
    for (const path of ['/', '/settings', '/sign-in']) {
      expect(guard({ path, session: ready('handle') }), path).toEqual(to('/onboarding/handle'));
    }
  });

  it('allows the current and earlier steps and brings a person back from a later one', () => {
    const session = ready('issues');
    expect(guard({ path: '/onboarding/photo', session })).toEqual(STAY);
    expect(guard({ path: '/onboarding/issues', session })).toEqual(STAY);
    expect(guard({ path: '/onboarding/location', session })).toEqual(to('/onboarding/issues'));
  });

  it('follows next once onboarding is done', () => {
    expect(guard({ path: '/sign-in', next: '/settings/export', session: ready('done') })).toEqual(
      to('/settings/export'),
    );
  });

  it('falls back to the remembered next, then to /', () => {
    const base = { path: '/onboarding/location', session: ready('done') };
    expect(guard({ ...base, rememberedNext: '/settings' })).toEqual(to('/settings'));
    expect(guard(base)).toEqual(to('/'));
    expect(guard({ ...base, next: '/sign-in' })).toEqual(to('/'));
  });

  it('does not move a person off onboarding while the reveal shows', () => {
    expect(
      guard({ path: '/onboarding/location', revealShowing: true, session: ready('done') }),
    ).toEqual(STAY);
  });

  it('an admin path is not found in the public app', () => {
    expect(guard({ path: '/admin', session: ready('done', 'admin') })).toEqual(STAY);
    expect(guard({ path: '/admin/reports', session: ready('done', 'user') })).toEqual(STAY);
  });

  it('sends /create to / at medium and expanded only', () => {
    const base = { path: '/create', session: ready('done') };
    expect(guard({ ...base, breakpoint: 'medium' })).toEqual(to('/'));
    expect(guard({ ...base, breakpoint: 'expanded' })).toEqual(to('/'));
    expect(guard({ ...base, breakpoint: 'compact' })).toEqual(STAY);
  });

  it('stays otherwise', () => {
    expect(guard({ path: '/settings', session: ready('done') })).toEqual(STAY);
    expect(guard({ path: '/nowhere' })).toEqual(STAY);
  });
});

describe('the shell', () => {
  it('draws the bare shell where the contract says', () => {
    for (const path of ['/sign-in', '/onboarding/photo', '/dev/gallery', '/nowhere']) {
      expect(shellModeFor(path, false), path).toBe('bare');
    }
    expect(shellModeFor('/', true)).toBe('bare');
    expect(shellModeFor('/settings', false)).toBe('app');
  });

  it('marks the active item and remembers the tab under a pushed route', () => {
    expect(activeItemFor('/')).toBe('home');
    expect(activeItemFor('/settings/export')).toBe('profile');
    rememberTabItem('home');
    expect(activeItemFor('/office/x')).toBe('home');
    resetNavigationState();
    expect(activeItemFor('/office/x')).toBeNull();
  });

  it("leads the shell's items to their routes, Profile to settings, and to sign-in when signed out", () => {
    const targets: Record<NavItemId, string> = {
      home: '/',
      explore: '/explore',
      post: '/create',
      activity: '/activity',
      messages: '/messages',
      profile: '/settings',
    };
    for (const [item, target] of Object.entries(targets) as [NavItemId, string][]) {
      expect(navTargetFor(item, true), item).toBe(target);
      expect(navTargetFor(item, false), item).toBe(
        item === 'home' ? '/' : `/sign-in?next=${encodeURIComponent(target)}`,
      );
    }
  });
});

describe('the router calls', () => {
  it('navigates only to safe paths', () => {
    markNavigationReady();
    navigateTo('//evil.example');
    replaceWith('/settings');
    expect(routerCalls).toEqual([
      { op: 'push', path: '/' },
      { op: 'replace', path: '/settings' },
    ]);
  });

  it('holds a navigation until the navigator is ready', () => {
    expect(isNavigationReady()).toBe(false);
    replaceWith('/welcome');
    replaceWith('/sign-in');
    expect(routerCalls).toEqual([]);
    markNavigationReady();
    expect(isNavigationReady()).toBe(true);
    expect(routerCalls).toEqual([{ op: 'replace', path: '/sign-in' }]);
  });

  it('goes back when it can, else replaces with the fallback', () => {
    markNavigationReady();
    setCanGoBack(true);
    goBack('/settings');
    expect(routerCalls).toEqual([{ op: 'back', path: null }]);
    setCanGoBack(false);
    goBack('/settings');
    expect(routerCalls).toEqual([
      { op: 'back', path: null },
      { op: 'replace', path: '/settings' },
    ]);
  });

  it('dismisses back to a root path', () => {
    markNavigationReady();
    dismissTo('/settings');
    expect(routerCalls).toEqual([{ op: 'dismissTo', path: '/settings' }]);
  });
});

describe('location memory', () => {
  it('keeps next in memory only', () => {
    rememberNext('/settings?x=1');
    expect(peekRememberedNext()).toBe('/settings');
    clearRememberedNext();
    expect(peekRememberedNext()).toBeNull();
    expect(storageFake.calls.filter((call) => call.op === 'set')).toEqual([]);
  });

  it('knows the current location', () => {
    expect(isAtLocation('/sign-in?next=%2Fsettings', '/sign-in', '/settings')).toBe(true);
    expect(isAtLocation('/sign-in?next=%2Fsettings', '/sign-in', null)).toBe(false);
  });
});
