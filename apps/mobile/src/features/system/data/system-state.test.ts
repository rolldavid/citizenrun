import { afterEach, describe, expect, it, vi } from 'vitest';

import { storage } from '@/platform/storage';
import { storageFake } from '@/test/platform/storage';

import {
  getBoot,
  getThemeChoice,
  isMinorEnded,
  isUpgradeBlocked,
  markStorageHydrated,
  resetSystemState,
  setBoot,
  setMinorEnded,
  setThemeChoice,
  setUpgradeBlocked,
  subscribeSystemState,
} from './system-state';

afterEach(() => {
  resetSystemState();
});

describe('the theme choice', () => {
  it('theme is system before the store is hydrated', () => {
    storageFake.seed({ theme: 'dark' });
    const get = vi.spyOn(storage, 'get');
    expect(getThemeChoice()).toBe('system');
    expect(get).not.toHaveBeenCalled();
  });

  it('theme follows the store after hydration', () => {
    storageFake.seed({ theme: 'dark' });
    const listener = vi.fn();
    subscribeSystemState(listener);
    markStorageHydrated();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getThemeChoice()).toBe('dark');
  });

  it('is system after hydration when nothing is stored', () => {
    markStorageHydrated();
    expect(getThemeChoice()).toBe('system');
  });

  it('setting the theme writes the key and notifies', () => {
    markStorageHydrated();
    const listener = vi.fn();
    const unsubscribe = subscribeSystemState(listener);
    setThemeChoice('light');
    expect(storageFake.calls).toContainEqual({ op: 'set', key: 'theme' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getThemeChoice()).toBe('light');
    unsubscribe();
    setThemeChoice('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('the flags', () => {
  it('the three flags start false or starting and notify', () => {
    expect(getBoot()).toBe('starting');
    expect(isUpgradeBlocked()).toBe(false);
    expect(isMinorEnded()).toBe(false);
    const listener = vi.fn();
    subscribeSystemState(listener);
    setBoot('ready');
    setUpgradeBlocked(true);
    setMinorEnded(true);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getBoot()).toBe('ready');
    expect(isUpgradeBlocked()).toBe(true);
    expect(isMinorEnded()).toBe(true);
    // Setting a value it already holds tells nobody.
    setBoot('ready');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('marks and resets the blocked upgrade', () => {
    setUpgradeBlocked(true);
    expect(isUpgradeBlocked()).toBe(true);
    resetSystemState();
    expect(isUpgradeBlocked()).toBe(false);
  });

  it('a reset restores every default', () => {
    setBoot('ready');
    setMinorEnded(true);
    markStorageHydrated();
    storageFake.seed({ theme: 'dark' });
    resetSystemState();
    expect(getBoot()).toBe('starting');
    expect(isMinorEnded()).toBe(false);
    expect(getThemeChoice()).toBe('system');
  });
});
