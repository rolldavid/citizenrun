import type { FilingStatus, FilingWindowInput } from '@citizenrun/shared';
import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { filingStatusFor, officeFilingStatus } from './filing-status.ts';

// The windows of the L-filing-window-state fixture table.
const NEW_YORK_TRACK: FilingWindowInput = {
  opensOn: '2027-07-02',
  closesOn: '2027-07-17',
  closesTime: '12:00',
  zone: 'America/New_York',
};
const CHICAGO_TRACK: FilingWindowInput = {
  opensOn: null,
  closesOn: '2027-08-05',
  closesTime: '17:00',
  zone: 'America/Chicago',
};

const ROWS: readonly {
  name: string;
  window: FilingWindowInput | null;
  now: string;
  expected: FilingStatus;
}[] = [
  {
    name: 'no election is no_election',
    window: null,
    now: '2027-07-17T15:59:00Z',
    expected: 'no_election',
  },
  {
    name: 'an unknown window (fixture row 1) is dates_not_known',
    window: { opensOn: null, closesOn: null, closesTime: null, zone: 'America/New_York' },
    now: '2027-07-17T15:59:00Z',
    expected: 'dates_not_known',
  },
  {
    name: 'a closed window (fixture row 3) is closed',
    window: NEW_YORK_TRACK,
    now: '2027-07-17T16:00:00Z',
    expected: 'closed',
  },
  {
    name: 'a window not open yet (fixture row 6) is not_open_yet',
    window: NEW_YORK_TRACK,
    now: '2027-06-30T12:00:00Z',
    expected: 'not_open_yet',
  },
  {
    name: 'an open window with no opening date (fixture row 7) is opens_not_known',
    window: CHICAGO_TRACK,
    now: '2027-08-03T12:00:00Z',
    expected: 'opens_not_known',
  },
  {
    name: 'an open window with a known opening date (fixture row 7 with opensOn) is open',
    window: { ...CHICAGO_TRACK, opensOn: '2027-07-20' },
    now: '2027-08-03T12:00:00Z',
    expected: 'open',
  },
  {
    name: 'an open window on its last day before the hour (fixture row 2) is open',
    window: NEW_YORK_TRACK,
    now: '2027-07-17T15:59:00Z',
    expected: 'open',
  },
];

describe('filingStatusFor', () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      await eachZone(() => {
        expect(filingStatusFor(row.window, new Date(row.now))).toBe(row.expected);
      });
    });
  }
});

describe('officeFilingStatus', () => {
  it('an office with a next election takes its status', async () => {
    await eachZone(() => {
      expect(
        officeFilingStatus(
          { next: CHICAGO_TRACK, lastElectionDate: '2027-11-02', zone: 'America/Chicago' },
          new Date('2027-08-03T12:00:00Z'),
        ),
      ).toBe('opens_not_known');
    });
  });

  it('an office with no next election and a later election is closed', async () => {
    await eachZone(() => {
      expect(
        officeFilingStatus(
          { next: null, lastElectionDate: '2027-11-02', zone: 'America/Chicago' },
          new Date('2027-09-01T12:00:00Z'),
        ),
      ).toBe('closed');
    });
  });

  it('an office with only past elections has no election', async () => {
    await eachZone(() => {
      const now = new Date('2027-09-01T12:00:00Z');
      expect(
        officeFilingStatus(
          { next: null, lastElectionDate: '2026-11-03', zone: 'America/Chicago' },
          now,
        ),
      ).toBe('no_election');
      expect(
        officeFilingStatus({ next: null, lastElectionDate: null, zone: 'America/Chicago' }, now),
      ).toBe('no_election');
    });
  });

  it("the later election is compared in the office's zone", async () => {
    await eachZone(() => {
      const before = new Date('2027-03-04T15:00:00Z'); // 2027-03-05 01:00 in Guam
      const after = new Date('2027-03-05T15:00:00Z'); // 2027-03-06 01:00 in Guam
      const input = { next: null, lastElectionDate: '2027-03-05' };
      expect(officeFilingStatus({ ...input, zone: 'Pacific/Guam' }, before)).toBe('closed');
      expect(officeFilingStatus({ ...input, zone: 'America/New_York' }, before)).toBe('closed');
      expect(officeFilingStatus({ ...input, zone: 'Pacific/Guam' }, after)).toBe('no_election');
    });
  });

  it('a null zone uses the fallback zone', async () => {
    await eachZone(() => {
      const input = { next: null, lastElectionDate: '2027-03-05', zone: null };
      // 2027-03-06 in UTC but 22:00 on 2027-03-05 in New York.
      expect(officeFilingStatus(input, new Date('2027-03-06T03:00:00Z'))).toBe('closed');
      // Midnight of 2027-03-06 in New York.
      expect(officeFilingStatus(input, new Date('2027-03-06T05:00:00Z'))).toBe('no_election');
    });
  });
});
