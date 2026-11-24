import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';

import { playHaptic } from './haptic';

// The module keeps the time of the last haptic, so each case starts a full second after the last.
let start = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  start += 1000;
  vi.setSystemTime(start);
});

afterEach(() => {
  vi.useRealTimers();
});

function at(ms: number): void {
  vi.setSystemTime(start + ms);
}

describe('playHaptic', () => {
  it('each name calls its module method', () => {
    const names = ['selection', 'light', 'medium', 'success', 'warning'] as const;
    names.forEach((name, index) => {
      at(index * 100);
      playHaptic(name);
    });
    expect(hapticsFake.calls).toEqual([
      { method: 'selection' },
      { method: 'impact', weight: 'light' },
      { method: 'impact', weight: 'medium' },
      { method: 'notify', kind: 'success' },
      { method: 'notify', kind: 'warning' },
    ]);
  });

  it('a call within 100 ms of the last one is dropped', () => {
    at(0);
    playHaptic('light');
    at(99);
    playHaptic('medium');
    expect(hapticsFake.calls).toEqual([{ method: 'impact', weight: 'light' }]);
    at(100);
    playHaptic('success');
    expect(hapticsFake.calls).toEqual([
      { method: 'impact', weight: 'light' },
      { method: 'notify', kind: 'success' },
    ]);
  });

  it('a dropped call does not move the window', () => {
    at(0);
    playHaptic('selection');
    at(60);
    playHaptic('light');
    at(120);
    playHaptic('medium');
    expect(hapticsFake.calls).toEqual([
      { method: 'selection' },
      { method: 'impact', weight: 'medium' },
    ]);
  });
});
