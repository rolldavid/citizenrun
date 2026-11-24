import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const rn = vi.hoisted(() => {
  const Platform: { OS: string; Version: number | string } = { OS: 'ios', Version: 17 };
  return { Platform };
});

// Plain recording functions, not vi.fn: a Vitest spy observes the promises it returns, so a rejection
// from a spy can never be unhandled and the rejection case below could not fail.
const lib = vi.hoisted(() => {
  type Call = [name: string, arg: string | null];
  const state: { mode: 'resolve' | 'reject' | 'throw'; calls: Call[] } = {
    mode: 'resolve',
    calls: [],
  };
  function answer(name: string, arg: string | null): Promise<void> {
    state.calls.push([name, arg]);
    if (state.mode === 'throw') {
      throw new Error('x');
    }
    return state.mode === 'reject' ? Promise.reject(new Error('x')) : Promise.resolve();
  }
  return {
    state,
    selectionAsync: () => answer('selectionAsync', null),
    impactAsync: (style: string) => answer('impactAsync', style),
    notificationAsync: (type: string) => answer('notificationAsync', type),
    performAndroidHapticsAsync: (type: string) => answer('performAndroidHapticsAsync', type),
  };
});

function callsOf(name: string): (string | null)[] {
  return lib.state.calls.filter(([called]) => called === name).map(([, arg]) => arg);
}

vi.mock('react-native', () => rn);

vi.mock('expo-haptics', () => ({
  selectionAsync: lib.selectionAsync,
  impactAsync: lib.impactAsync,
  notificationAsync: lib.notificationAsync,
  performAndroidHapticsAsync: lib.performAndroidHapticsAsync,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: {
    Clock_Tick: 'clock-tick',
    Context_Click: 'context-click',
    Long_Press: 'long-press',
    Confirm: 'confirm',
    Reject: 'reject',
  },
}));

const { haptics } = await vi.importActual<typeof NativeIndex>('./index.native');
const { haptics: webHaptics } = await vi.importActual<typeof WebIndex>('./index.web');

function playAll(): void {
  haptics.selection();
  haptics.impact('light');
  haptics.impact('medium');
  haptics.notify('success');
  haptics.notify('warning');
}

describe('haptics', () => {
  beforeEach(() => {
    rn.Platform.OS = 'ios';
    rn.Platform.Version = 17;
    lib.state.mode = 'resolve';
    lib.state.calls.length = 0;
  });

  it('iOS calls the iOS functions', () => {
    expect(haptics.supported).toBe(true);
    playAll();
    expect(callsOf('selectionAsync')).toEqual([null]);
    expect(callsOf('impactAsync')).toEqual(['light', 'medium']);
    expect(callsOf('notificationAsync')).toEqual(['success', 'warning']);
    expect(callsOf('performAndroidHapticsAsync')).toEqual([]);
  });

  it('Android calls the Android constants', () => {
    rn.Platform.OS = 'android';
    rn.Platform.Version = 33;
    playAll();
    expect(lib.state.calls).toEqual([
      ['performAndroidHapticsAsync', 'clock-tick'],
      ['performAndroidHapticsAsync', 'context-click'],
      ['performAndroidHapticsAsync', 'long-press'],
      ['performAndroidHapticsAsync', 'confirm'],
      ['performAndroidHapticsAsync', 'reject'],
    ]);
  });

  it('Android below API 30 uses Long_Press for notifications', () => {
    rn.Platform.OS = 'android';
    rn.Platform.Version = 29;
    haptics.notify('success');
    haptics.notify('warning');
    expect(lib.state.calls).toEqual([
      ['performAndroidHapticsAsync', 'long-press'],
      ['performAndroidHapticsAsync', 'long-press'],
    ]);
  });

  it('a rejected library call is not unhandled', async () => {
    const spies = [
      vi.spyOn(haptics, 'selection'),
      vi.spyOn(haptics, 'impact'),
      vi.spyOn(haptics, 'notify'),
    ];
    lib.state.mode = 'reject';
    playAll();
    rn.Platform.OS = 'android';
    rn.Platform.Version = 33;
    playAll();

    lib.state.mode = 'throw';
    playAll();
    rn.Platform.OS = 'ios';
    playAll();

    for (const spy of spies) {
      expect(spy.mock.results.length).toBeGreaterThan(0);
      for (const result of spy.mock.results) {
        expect(result).toEqual({ type: 'return', value: undefined });
      }
    }
    expect(lib.state.calls).toHaveLength(20);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('the web does nothing', () => {
    expect(webHaptics.supported).toBe(false);
    const spies = [
      vi.spyOn(webHaptics, 'selection'),
      vi.spyOn(webHaptics, 'impact'),
      vi.spyOn(webHaptics, 'notify'),
    ];
    webHaptics.selection();
    webHaptics.impact('light');
    webHaptics.impact('medium');
    webHaptics.notify('success');
    webHaptics.notify('warning');
    for (const spy of spies) {
      expect(spy.mock.results.length).toBeGreaterThan(0);
      for (const result of spy.mock.results) {
        expect(result).toEqual({ type: 'return', value: undefined });
      }
    }
    expect(lib.state.calls).toEqual([]);
  });
});
