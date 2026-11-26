import type { ElectionKind } from '@citizenrun/shared';
import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { KIND_ORDER_FOR_NEXT, pickNextElection } from './next-election.ts';
import type { ElectionCandidate } from './next-election.ts';

function election(
  id: string,
  electionDate: string,
  kind: ElectionKind,
  party: string | null,
  filingDeadline: string | null,
  filingDeadlineTime: string | null = null,
): ElectionCandidate {
  return {
    id,
    electionDate,
    kind,
    party,
    filingOpens: null,
    filingDeadline,
    filingDeadlineTime,
    proof: null,
  };
}

const ROW_1_ELECTIONS = [
  election('e1', '2028-03-07', 'primary', 'democratic', '2027-12-13'),
  election('e2', '2028-03-07', 'primary', 'republican', '2027-12-13'),
  election('e3', '2028-11-07', 'general', null, '2028-06-30'),
];

// The L-target-election fixture table, column nextFileable.
const ROWS: readonly {
  row: number;
  elections: readonly ElectionCandidate[];
  today: string;
  nextFileable: string | null;
}[] = [
  { row: 1, elections: ROW_1_ELECTIONS, today: '2027-11-15', nextFileable: 'e1' },
  { row: 2, elections: ROW_1_ELECTIONS, today: '2027-11-15', nextFileable: 'e1' },
  {
    row: 3,
    elections: [
      election('e4', '2027-08-03', 'primary', null, '2027-05-07'),
      election('e5', '2027-11-02', 'general', null, null),
    ],
    today: '2027-06-01',
    nextFileable: 'e5',
  },
  {
    row: 4,
    elections: [election('e6', '2027-11-02', 'general', null, '2027-08-16')],
    today: '2027-09-01',
    nextFileable: null,
  },
  {
    row: 5,
    elections: [election('e7', '2026-11-03', 'general', null, '2026-07-01')],
    today: '2027-09-01',
    nextFileable: null,
  },
  { row: 6, elections: [], today: '2027-09-01', nextFileable: null },
  {
    row: 7,
    elections: [
      election('e8', '2027-04-06', 'general', null, '2026-11-23'),
      election('e9', '2027-02-23', 'primary', null, '2026-10-26'),
    ],
    today: '2026-10-20',
    nextFileable: 'e9',
  },
  {
    row: 8,
    elections: [
      election('e10', '2027-08-03', 'primary', 'democratic', '2027-05-07'),
      election('e11', '2027-08-31', 'primary_runoff', 'democratic', null),
      election('e12', '2027-11-02', 'general', null, '2027-09-03'),
    ],
    today: '2027-06-01',
    nextFileable: 'e12',
  },
];

const CHICAGO = 'America/Chicago';

describe('pickNextElection', () => {
  it('names the kind order of rule 2', () => {
    expect(KIND_ORDER_FOR_NEXT).toEqual([
      'primary',
      'general',
      'special',
      'primary_runoff',
      'general_runoff',
    ]);
  });

  for (const row of ROWS) {
    it(`fixture row ${String(row.row)} gives ${row.nextFileable ?? 'no election'}`, async () => {
      await eachZone(() => {
        const picked = pickNextElection(
          { storedId: null, candidates: row.elections, zone: CHICAGO },
          new Date(`${row.today}T12:00:00Z`),
        );
        expect(picked?.id ?? null).toBe(row.nextFileable);
      });
    });
  }

  it('a runoff is never fileable', async () => {
    await eachZone(() => {
      const now = new Date('2027-06-01T12:00:00Z');
      const runoffs = [
        election('r1', '2027-06-20', 'primary_runoff', 'democratic', null),
        election('r2', '2027-06-21', 'general_runoff', null, null),
      ];
      const general = election('g1', '2027-11-02', 'general', null, '2027-09-03');
      expect(
        pickNextElection({ storedId: null, candidates: [...runoffs, general], zone: CHICAGO }, now)
          ?.id,
      ).toBe('g1');
      expect(pickNextElection({ storedId: null, candidates: runoffs, zone: CHICAGO }, now)).toBe(
        null,
      );
    });
  });

  it('a deadline today is fileable all day', async () => {
    await eachZone(() => {
      // 23:30 on 2027-03-05 in Los Angeles, past the stated closing hour.
      const now = new Date('2027-03-06T07:30:00Z');
      const today = election('t1', '2027-04-06', 'general', null, '2027-03-05', '17:00');
      const later = election('t2', '2027-05-04', 'general', null, '2027-04-01');
      expect(
        pickNextElection(
          { storedId: null, candidates: [later, today], zone: 'America/Los_Angeles' },
          now,
        )?.id,
      ).toBe('t1');
    });
  });

  it('a deadline that is today in Pago Pago but yesterday in New York is skipped', async () => {
    await eachZone(() => {
      // 01:00 on 2027-03-06 in New York, 19:00 on 2027-03-05 in Pago Pago.
      const now = new Date('2027-03-06T06:00:00Z');
      const passed = election('p1', '2027-04-06', 'general', null, '2027-03-05');
      const next = election('p2', '2027-05-04', 'general', null, '2027-04-01');
      expect(
        pickNextElection(
          { storedId: null, candidates: [passed, next], zone: 'America/New_York' },
          now,
        )?.id,
      ).toBe('p2');
    });
  });

  it('ties follow the kind order', async () => {
    await eachZone(() => {
      const now = new Date('2027-06-01T12:00:00Z');
      const general = election('k1', '2027-11-02', 'general', null, '2027-09-03');
      const primary = election('k2', '2027-11-02', 'primary', null, '2027-09-03');
      expect(
        pickNextElection({ storedId: null, candidates: [general, primary], zone: CHICAGO }, now)
          ?.id,
      ).toBe('k2');
    });
  });

  it('a stored id wins', async () => {
    await eachZone(() => {
      const now = new Date('2027-06-01T12:00:00Z');
      const first = election('s1', '2027-08-03', 'primary', null, '2027-07-01');
      const stored = election('s2', '2027-11-02', 'general', null, '2027-09-03');
      expect(
        pickNextElection({ storedId: 's2', candidates: [first, stored], zone: CHICAGO }, now)?.id,
      ).toBe('s2');
      expect(
        pickNextElection({ storedId: 's3', candidates: [first, stored], zone: CHICAGO }, now),
      ).toBe(null);
    });
  });
});
