import { afterEach, describe, expect, it, vi } from 'vitest';

import { storageFake } from '@/test/platform/storage';

import { blockedUntilFrom, evaluateBirthMonth, GATE_BLOCK_MS } from './dob-gate';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

// The phone file's libraries; the gate members reach none of them.
vi.mock('expo-age-range', () => ({
  getRequiredRegulatoryFeaturesAsync: vi.fn(),
  isEligibleForAgeFeaturesAsync: vi.fn(),
  requestAgeRangeAsync: vi.fn(),
  requestAgeSignalsAccessAsync: vi.fn(),
  showSignificantUpdateAcknowledgmentAsync: vi.fn(),
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: { getInitialURL: vi.fn() },
}));

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const NOW = new Date('2027-01-31T15:30:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('evaluateBirthMonth', () => {
  it('born January 2009 is a minor on 2027-01-31 and an adult on 2027-02-01', () => {
    expect(evaluateBirthMonth({ year: 2009, month: 1 }, '2027-01-31')).toBe('minor');
    expect(evaluateBirthMonth({ year: 2009, month: 1 }, '2027-02-01')).toBe('adult');
  });

  it('born December 2008 is an adult on 2027-01-01 and a minor on 2026-12-31', () => {
    expect(evaluateBirthMonth({ year: 2008, month: 12 }, '2027-01-01')).toBe('adult');
    expect(evaluateBirthMonth({ year: 2008, month: 12 }, '2026-12-31')).toBe('minor');
  });

  it('month 13 is a minor', () => {
    const today = '2027-06-15';
    expect(evaluateBirthMonth({ year: 1990, month: 13 }, today)).toBe('minor');
    expect(evaluateBirthMonth({ year: 1990, month: 0 }, today)).toBe('minor');
    expect(evaluateBirthMonth({ year: 1990, month: 1.5 }, today)).toBe('minor');
    expect(evaluateBirthMonth({ year: 1990, month: Number.NaN }, today)).toBe('minor');
    expect(evaluateBirthMonth({ year: 1899, month: 6 }, today)).toBe('minor');
    expect(evaluateBirthMonth({ year: 2028, month: 1 }, today)).toBe('minor');
    expect(evaluateBirthMonth({ year: 1990.5, month: 6 }, today)).toBe('minor');
    // the edges of the allowed range are real answers
    expect(evaluateBirthMonth({ year: 1900, month: 1 }, today)).toBe('adult');
    expect(evaluateBirthMonth({ year: 1990, month: 12 }, today)).toBe('adult');
    expect(evaluateBirthMonth({ year: 2027, month: 1 }, today)).toBe('minor');
  });

  it('a malformed today is a minor', () => {
    for (const today of ['', 'today', '2027-6-15', '2027-06-15T00:00:00.000Z', ' 2027-06-15']) {
      expect(evaluateBirthMonth({ year: 1990, month: 6 }, today), today).toBe('minor');
    }
  });

  it('the answer reads only the date it is given', () => {
    // the device's clock plays no part: the caller passes today's UTC date
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    expect(evaluateBirthMonth({ year: 2009, month: 1 }, '2027-02-01')).toBe('adult');
  });

  it('both index files use the same gate', () => {
    for (const ageAssurance of [native.ageAssurance, web.ageAssurance]) {
      expect(ageAssurance.evaluateBirthMonth({ year: 2009, month: 1 }, '2027-01-31')).toBe('minor');
      expect(ageAssurance.evaluateBirthMonth({ year: 2009, month: 1 }, '2027-02-01')).toBe('adult');
      expect(ageAssurance.evaluateBirthMonth({ year: 1990, month: 13 }, '2027-02-01')).toBe(
        'minor',
      );
    }
  });
});

describe.each([
  ['index.native', native.ageAssurance],
  ['index.web', web.ageAssurance],
])('the gate lock in %s', (_file, ageAssurance) => {
  it('the block lasts 24 hours', () => {
    vi.setSystemTime(NOW);
    expect(ageAssurance.gateBlockedUntil()).toBeNull();
    ageAssurance.blockGate(NOW);
    const until = new Date(NOW.getTime() + 24 * HOUR_MS).toISOString();

    vi.setSystemTime(new Date(NOW.getTime() + 23 * HOUR_MS + 59 * MINUTE_MS));
    expect(ageAssurance.gateBlockedUntil()).toBe(until);

    vi.setSystemTime(new Date(NOW.getTime() + 24 * HOUR_MS + MINUTE_MS));
    expect(ageAssurance.gateBlockedUntil()).toBeNull();
  });

  it('nothing of the birth month is kept', () => {
    expect(ageAssurance.evaluateBirthMonth({ year: 2010, month: 7 }, '2027-01-31')).toBe('minor');
    ageAssurance.blockGate(NOW);
    expect(storageFake.calls).toEqual([{ op: 'set', key: 'ageGate.blockedUntil' }]);
    // the only value written is the lock's instant
    vi.setSystemTime(NOW);
    expect(ageAssurance.gateBlockedUntil()).toBe(blockedUntilFrom(NOW));
  });

  it('a lock the store already holds is read', () => {
    vi.setSystemTime(NOW);
    const held = new Date(NOW.getTime() + HOUR_MS).toISOString();
    storageFake.seed({ 'ageGate.blockedUntil': held });
    expect(ageAssurance.gateBlockedUntil()).toBe(held);
  });
});

describe('blockedUntilFrom', () => {
  it('is now plus 24 hours as an ISO instant', () => {
    expect(GATE_BLOCK_MS).toBe(24 * HOUR_MS);
    expect(blockedUntilFrom(NOW)).toBe('2027-02-01T15:30:00.000Z');
  });
});
