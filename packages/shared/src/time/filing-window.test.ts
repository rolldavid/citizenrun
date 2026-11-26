import { describe, expect, it } from 'vitest';
import { eachZone } from '../testing/zones.ts';
import { filingWindowState } from './filing-window.ts';
import type { FilingWindowInput, FilingWindowState } from './filing-window.ts';

const NEW_YORK_TRACK: FilingWindowInput = {
  opensOn: '2027-07-02',
  closesOn: '2027-07-17',
  closesTime: '12:00',
  zone: 'America/New_York',
};
const NEW_YORK_NO_TIME: FilingWindowInput = { ...NEW_YORK_TRACK, closesTime: null };
const CHICAGO_TRACK: FilingWindowInput = {
  opensOn: null,
  closesOn: '2027-08-05',
  closesTime: '17:00',
  zone: 'America/Chicago',
};

const ROWS: readonly {
  name: string;
  input: FilingWindowInput;
  now: string;
  expected: FilingWindowState;
}[] = [
  {
    name: 'row 1: no closing date is unknown',
    input: { opensOn: null, closesOn: null, closesTime: null, zone: 'America/New_York' },
    now: '2027-07-17T15:59:00Z',
    expected: { state: 'unknown' },
  },
  {
    name: 'row 2: open on the last day before the closing hour',
    input: NEW_YORK_TRACK,
    now: '2027-07-17T15:59:00Z',
    expected: { state: 'open', daysLeft: 0, closesTime: '12:00' },
  },
  {
    name: 'row 3: closed at the closing hour',
    input: NEW_YORK_TRACK,
    now: '2027-07-17T16:00:00Z',
    expected: { state: 'closed', closedDaysAgo: 0 },
  },
  {
    name: 'row 4: no closing time keeps the last day open',
    input: NEW_YORK_NO_TIME,
    now: '2027-07-17T23:00:00Z',
    expected: { state: 'open', daysLeft: 0, closesTime: null },
  },
  {
    name: 'row 5: closed the day after',
    input: NEW_YORK_NO_TIME,
    now: '2027-07-18T04:00:00Z',
    expected: { state: 'closed', closedDaysAgo: 1 },
  },
  {
    name: 'row 6: not open yet',
    input: NEW_YORK_TRACK,
    now: '2027-06-30T12:00:00Z',
    expected: { state: 'not_open', opensInDays: 2, closesInDays: 17 },
  },
  {
    name: 'row 7: open with days left',
    input: CHICAGO_TRACK,
    now: '2027-08-03T12:00:00Z',
    expected: { state: 'open', daysLeft: 2, closesTime: '17:00' },
  },
  {
    name: 'row 8: closed at 17:00 local',
    input: CHICAGO_TRACK,
    now: '2027-08-05T22:00:00Z',
    expected: { state: 'closed', closedDaysAgo: 0 },
  },
];

describe('filingWindowState', () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      await eachZone(() => {
        expect(filingWindowState(row.input, new Date(row.now))).toEqual(row.expected);
      });
    });
  }

  it('a window that opens today is open', async () => {
    await eachZone(() => {
      const input: FilingWindowInput = {
        opensOn: '2027-07-07',
        closesOn: '2027-07-17',
        closesTime: null,
        zone: 'America/New_York',
      };
      expect(filingWindowState(input, new Date('2027-07-07T14:00:00Z'))).toEqual({
        state: 'open',
        daysLeft: 10,
        closesTime: null,
      });
    });
  });

  it('closed at the closing hour, not before', async () => {
    await eachZone(() => {
      expect(filingWindowState(NEW_YORK_TRACK, new Date('2027-07-17T15:59:00Z'))).toEqual({
        state: 'open',
        daysLeft: 0,
        closesTime: '12:00',
      });
      expect(filingWindowState(NEW_YORK_TRACK, new Date('2027-07-17T16:00:00Z'))).toEqual({
        state: 'closed',
        closedDaysAgo: 0,
      });
    });
  });

  it('a missing zone counts in Eastern time', async () => {
    await eachZone(() => {
      const input: FilingWindowInput = { ...NEW_YORK_TRACK, zone: null };
      expect(filingWindowState(input, new Date('2027-07-17T16:00:00Z'))).toEqual({
        state: 'closed',
        closedDaysAgo: 0,
      });
    });
  });
});
