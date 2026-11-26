import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getSessionPresence,
  resetSessionPresence,
  setSessionPresence,
  subscribeSessionPresence,
} from './session-state';

afterEach(() => {
  resetSessionPresence();
});

describe('session presence', () => {
  it('starts unknown', () => {
    expect(getSessionPresence()).toBe('unknown');
  });

  it('notifies subscribers of a change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionPresence(listener);
    setSessionPresence('present');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSessionPresence()).toBe('present');
    setSessionPresence('present');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionPresence(listener);
    unsubscribe();
    setSessionPresence('absent');
    expect(listener).not.toHaveBeenCalled();
    expect(getSessionPresence()).toBe('absent');
  });
});
