import { afterEach, describe, expect, it } from 'vitest';

import { reportOptimisticFailure, subscribeOptimisticFailures } from './optimistic-failures';
import type { OptimisticFailure } from './optimistic-failures';

const subscriptions: (() => void)[] = [];

function listen(listener: (failure: OptimisticFailure) => void): () => void {
  const unsubscribe = subscribeOptimisticFailures(listener);
  subscriptions.push(unsubscribe);
  return unsubscribe;
}

afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) {
    unsubscribe();
  }
});

describe('the optimistic failure store', () => {
  it('delivers to every subscriber with a rising seq', () => {
    const first: OptimisticFailure[] = [];
    const second: OptimisticFailure[] = [];
    listen((failure) => first.push(failure));
    listen((failure) => second.push(failure));

    reportOptimisticFailure({ action: 'follow', code: 'daily_limit_reached' });
    reportOptimisticFailure({ action: 'unbookmark', code: 'unavailable' });

    for (const received of [first, second]) {
      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({ action: 'follow', code: 'daily_limit_reached' });
      expect(received[1]).toMatchObject({ action: 'unbookmark', code: 'unavailable' });
      // The first reports of this file's own module instance.
      expect(received.map((each) => each.seq)).toEqual([1, 2]);
    }
  });

  it('unsubscribe stops delivery', () => {
    const kept: OptimisticFailure[] = [];
    const dropped: OptimisticFailure[] = [];
    listen((failure) => kept.push(failure));
    const unsubscribe = listen((failure) => dropped.push(failure));

    unsubscribe();
    reportOptimisticFailure({ action: 'bookmark', code: 'internal' });

    expect(kept).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it('a throwing listener is removed', () => {
    let thrown = 0;
    const received: OptimisticFailure[] = [];
    listen(() => {
      thrown += 1;
      throw new Error('a broken listener');
    });
    listen((failure) => received.push(failure));

    reportOptimisticFailure({ action: 'follow', code: 'internal' });
    expect(received).toHaveLength(1);
    expect(thrown).toBe(1);

    reportOptimisticFailure({ action: 'unfollow', code: 'internal' });
    expect(received).toHaveLength(2);
    expect(thrown).toBe(1);
  });
});
