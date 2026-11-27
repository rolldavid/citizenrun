import type { FilingStatus } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { runStateFor } from './run-state';
import type { RunStateInput } from './run-state';

const RETIRED_AT = '2026-10-01T00:00:00.000Z';

function office(overrides: {
  placeholder?: boolean;
  retiredAt?: string | null;
  running?: boolean;
  filingStatus?: FilingStatus;
}): RunStateInput {
  return {
    placeholder: overrides.placeholder ?? false,
    retiredAt: overrides.retiredAt ?? null,
    filingStatus: overrides.filingStatus ?? 'open',
    viewer: { running: overrides.running ?? false },
  };
}

describe('runStateFor', () => {
  it('hidden whenever Run is not built', () => {
    const offices = [
      office({ placeholder: true }),
      office({ retiredAt: RETIRED_AT }),
      office({ running: true }),
      office({ filingStatus: 'no_election' }),
      office({ filingStatus: 'closed' }),
      office({ filingStatus: 'open' }),
    ];
    for (const each of offices) {
      expect(runStateFor(each, false)).toEqual({ runState: 'hidden', runUnavailable: null });
    }
  });

  it('placeholder first', () => {
    expect(
      runStateFor(office({ placeholder: true, retiredAt: RETIRED_AT, running: true }), true),
    ).toEqual({ runState: 'unavailable', runUnavailable: 'placeholder' });
  });

  it('retired before running', () => {
    expect(runStateFor(office({ retiredAt: RETIRED_AT, running: true }), true)).toEqual({
      runState: 'unavailable',
      runUnavailable: 'retired',
    });
  });

  it('running before the filing status', () => {
    expect(runStateFor(office({ running: true, filingStatus: 'closed' }), true)).toEqual({
      runState: 'running',
      runUnavailable: null,
    });
  });

  it('no election and closed', () => {
    expect(runStateFor(office({ filingStatus: 'no_election' }), true)).toEqual({
      runState: 'unavailable',
      runUnavailable: 'noElection',
    });
    expect(runStateFor(office({ filingStatus: 'closed' }), true)).toEqual({
      runState: 'unavailable',
      runUnavailable: 'closed',
    });
  });

  it('run before filing opens', () => {
    const statuses: FilingStatus[] = ['not_open_yet', 'dates_not_known', 'opens_not_known', 'open'];
    for (const filingStatus of statuses) {
      expect(runStateFor(office({ filingStatus }), true)).toEqual({
        runState: 'idle',
        runUnavailable: null,
      });
    }
  });
});
