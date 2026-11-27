import { createI18n } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { presentRunSlot } from './present-run-slot';

// The typed t accepts catalog keys only; the presenter passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;

describe('presentRunSlot', () => {
  it('each state', () => {
    expect(presentRunSlot({ runState: 'hidden', runUnavailable: null }, t)).toEqual({
      state: 'hidden',
    });
    expect(presentRunSlot({ runState: 'idle', runUnavailable: null }, t)).toEqual({
      state: 'idle',
    });
    expect(presentRunSlot({ runState: 'running', runUnavailable: null }, t)).toEqual({
      state: 'running',
    });
    const labels = (
      [
        ['placeholder', 'No filing details yet'],
        ['retired', 'No longer listed'],
        ['noElection', 'No election scheduled'],
        ['closed', 'Filing closed'],
      ] as const
    ).map(([reason, label]) => ({
      got: presentRunSlot({ runState: 'unavailable', runUnavailable: reason }, t),
      want: { state: 'unavailable', label },
    }));
    for (const { got, want } of labels) {
      expect(got).toEqual(want);
    }
  });

  it('unavailable needs a reason', () => {
    expect(() => presentRunSlot({ runState: 'unavailable', runUnavailable: null }, t)).toThrow(
      'An unavailable Run needs its reason.',
    );
  });
});
