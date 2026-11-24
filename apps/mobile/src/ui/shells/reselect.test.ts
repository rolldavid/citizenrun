import { describe, expect, it, vi } from 'vitest';

import { emitReselect, subscribeReselect } from './reselect';

describe('reselect', () => {
  it('a reselect reaches the listeners of its item only', () => {
    const home = vi.fn();
    const alsoHome = vi.fn();
    const explore = vi.fn();
    const stops = [
      subscribeReselect('home', home),
      subscribeReselect('home', alsoHome),
      subscribeReselect('explore', explore),
    ];

    emitReselect('home');
    expect(home).toHaveBeenCalledTimes(1);
    expect(alsoHome).toHaveBeenCalledTimes(1);
    expect(explore).not.toHaveBeenCalled();
    // In the order they subscribed.
    expect(home.mock.invocationCallOrder[0]).toBeLessThan(
      alsoHome.mock.invocationCallOrder[0] ?? 0,
    );

    emitReselect('explore');
    expect(explore).toHaveBeenCalledTimes(1);
    expect(home).toHaveBeenCalledTimes(1);

    // An item nobody listens to is a reselect with no effect.
    expect(() => {
      emitReselect('profile');
    }).not.toThrow();
    expect(home).toHaveBeenCalledTimes(1);
    expect(explore).toHaveBeenCalledTimes(1);

    for (const stop of stops) stop();
  });

  it('unsubscribing stops delivery', () => {
    const kept = vi.fn();
    const left = vi.fn();
    const stopKept = subscribeReselect('activity', kept);
    const stopLeft = subscribeReselect('activity', left);

    emitReselect('activity');
    stopLeft();
    emitReselect('activity');
    expect(left).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(2);

    // Unsubscribing twice takes nothing else away.
    stopLeft();
    emitReselect('activity');
    expect(kept).toHaveBeenCalledTimes(3);

    stopKept();
    emitReselect('activity');
    expect(kept).toHaveBeenCalledTimes(3);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('one function subscribed twice is two subscriptions', () => {
    const listener = vi.fn();
    const first = subscribeReselect('messages', listener);
    const second = subscribeReselect('messages', listener);

    emitReselect('messages');
    expect(listener).toHaveBeenCalledTimes(2);

    first();
    emitReselect('messages');
    expect(listener).toHaveBeenCalledTimes(3);

    second();
    emitReselect('messages');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a listener that leaves during a round does not stop the round', () => {
    const calls: string[] = [];
    const stops: (() => void)[] = [];
    stops.push(
      subscribeReselect('post', () => {
        calls.push('first');
        // The first listener takes itself and the one after it away.
        for (const stop of stops) stop();
      }),
      subscribeReselect('post', () => {
        calls.push('second');
      }),
    );

    emitReselect('post');
    // The round was set when it began, so the second listener still hears this one.
    expect(calls).toEqual(['first', 'second']);

    emitReselect('post');
    expect(calls).toEqual(['first', 'second']);
  });
});
