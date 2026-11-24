import { describe, expect, it } from 'vitest';

import {
  activeItemFor,
  buildRootViewModel,
  navTargetFor,
  shellModeFor,
  systemScreenFor,
} from './root.build';
import type { RootInput } from './root.build';
import type { NavItem } from './root.types';

const INPUT: RootInput = {
  pathname: '/',
  hydrated: true,
  storedTheme: null,
  fontsReady: true,
  upgradeBlocked: false,
  signedIn: false,
};

const actions = {
  onNavigate: (): void => undefined,
  onReselect: (): void => undefined,
};

function build(patch: Partial<RootInput>) {
  return buildRootViewModel({ ...INPUT, ...patch }, actions);
}

describe('buildRootViewModel', () => {
  it('starts while storage hydrates', () => {
    const vm = build({ hydrated: false, storedTheme: 'dark' });
    expect(vm.boot).toBe('starting');
    expect(vm.themeChoice).toBe('system');
  });

  it('reads the stored theme once hydrated', () => {
    expect(build({ storedTheme: 'dark' }).themeChoice).toBe('dark');
    expect(build({ storedTheme: 'light' }).themeChoice).toBe('light');
    expect(build({ storedTheme: 'system' }).themeChoice).toBe('system');
    expect(build({ storedTheme: null }).themeChoice).toBe('system');
    expect(build({}).boot).toBe('ready');
  });

  it('shows the update screen after a blocked upgrade', () => {
    const vm = build({ upgradeBlocked: true });
    expect(vm.system).toBe('update');
    expect(vm.shell.mode).toBe('bare');
    expect(vm.shell.active).toBeNull();
  });

  it('shows no system screen while nothing is blocked', () => {
    const vm = build({});
    expect(vm.system).toBeNull();
    expect(vm.shell.mode).toBe('app');
    expect(vm.shell.active).toBe('home');
  });

  it('passes the fonts answer and the session through', () => {
    expect(build({ fontsReady: false }).fontsReady).toBe(false);
    expect(build({ fontsReady: true }).fontsReady).toBe(true);
    expect(build({ signedIn: true }).shell.signedIn).toBe(true);
    expect(build({ signedIn: false }).shell.signedIn).toBe(false);
  });

  it('the shell has no unread counts and no place yet', () => {
    const vm = build({ signedIn: true });
    expect(vm.shell.unread).toEqual({ messages: 0, activity: 0 });
    expect(vm.shell.place).toBeNull();
  });

  it('hands over the given actions', () => {
    const vm = build({});
    expect(vm.onNavigate).toBe(actions.onNavigate);
    expect(vm.onReselect).toBe(actions.onReselect);
  });
});

describe('systemScreenFor', () => {
  it('is update only after a blocked upgrade', () => {
    expect(systemScreenFor(true)).toBe('update');
    expect(systemScreenFor(false)).toBeNull();
  });
});

describe('the shell of a path', () => {
  it('the hello route is the one app route', () => {
    expect(shellModeFor('/', null)).toBe('app');
    for (const path of ['/dev/gallery', '/dev/screens/hello/helloReady', '/no-such-page']) {
      expect(shellModeFor(path, null)).toBe('bare');
      expect(activeItemFor(path, null)).toBeNull();
    }
    expect(activeItemFor('/', null)).toBe('home');
  });

  it('a system screen makes every path bare with no active item', () => {
    expect(shellModeFor('/', 'update')).toBe('bare');
    expect(activeItemFor('/', 'update')).toBeNull();
  });
});

describe('navTargetFor', () => {
  const SIGNED_OUT: readonly (readonly [NavItem, string])[] = [
    ['home', '/'],
    ['explore', '/sign-in?next=%2Fexplore'],
    ['post', '/sign-in?next=%2Fcreate'],
    ['activity', '/sign-in?next=%2Factivity'],
    ['messages', '/sign-in?next=%2Fmessages'],
    ['profile', '/sign-in?next=%2Fprofile'],
  ];

  const SIGNED_IN: readonly (readonly [NavItem, string])[] = [
    ['home', '/'],
    ['explore', '/explore'],
    ['post', '/create'],
    ['activity', '/activity'],
    ['messages', '/messages'],
    ['profile', '/profile'],
  ];

  it.each(SIGNED_OUT)('signed-out navigation leads to sign-in except Home: %s', (item, target) => {
    expect(navTargetFor(item, false)).toBe(target);
  });

  it.each(SIGNED_IN)('signed-in navigation goes to each path: %s', (item, target) => {
    expect(navTargetFor(item, true)).toBe(target);
  });
});
