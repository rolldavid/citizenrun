import { describe, expect, it } from 'vitest';
import { concurrentTopOffice, turnoutClasses } from './turnout.ts';
import type { DatedContest } from './turnout.ts';

function contest(
  state: string,
  date: string,
  kind: DatedContest['kind'],
  officeTypeId: string,
  party: string | null = null,
  statewide = false,
): DatedContest {
  return { state, date, kind, party, officeTypeId, statewide };
}

describe('turnoutClasses', () => {
  it("05's rows pass through the stage's concurrent-office rule", () => {
    const cases: [DatedContest[], string, string][] = [
      // Row 3: Washington, an odd-year general with only local contests.
      [
        [contest('WA', '2027-11-02', 'general', 'city-council')],
        '2027-11-02|general|',
        'odd_year_general',
      ],
      // Row 4: Virginia, an odd-year general with a state-house contest.
      [
        [
          contest('VA', '2027-11-02', 'general', 'state-house'),
          contest('VA', '2027-11-02', 'general', 'county-commission'),
        ],
        '2027-11-02|general|',
        'odd_year_statewide',
      ],
      // Row 5: Illinois, a spring general, local.
      [
        [contest('IL', '2027-04-06', 'general', 'township-board')],
        '2027-04-06|general|',
        'spring_local',
      ],
      // Row 7: Louisiana, a majority primary with a governor contest.
      [
        [
          contest('LA', '2027-10-09', 'primary', 'governor', null, true),
          contest('LA', '2027-10-09', 'primary', 'sheriff'),
        ],
        '2027-10-09|primary|',
        'odd_year_statewide',
      ],
      // Row 8: Washington, a top-two primary, local.
      [[contest('WA', '2027-08-03', 'primary', 'city-council')], '2027-08-03|primary|', 'primary'],
      // Row 1: North Carolina, the presidential general.
      [
        [contest('NC', '2028-11-07', 'general', 'county-commission')],
        '2028-11-07|general|',
        'presidential_general',
      ],
    ];
    for (const [contests, key, expected] of cases) {
      expect(turnoutClasses(contests).get(key)).toBe(expected);
    }
    expect(concurrentTopOffice([contest('NC', '2028-11-07', 'general', 'county-commission')])).toBe(
      'president',
    );
  });

  it('classes every contest of a date, primaries by party', () => {
    const classes = turnoutClasses([
      contest('ZZ', '2026-05-05', 'primary', 'sheriff', 'democratic'),
      contest('ZZ', '2026-05-05', 'primary', 'sheriff', 'republican'),
      contest('ZZ', '2026-11-03', 'general', 'sheriff'),
    ]);
    expect([...classes]).toEqual([
      ['2026-05-05|primary|democratic', 'primary'],
      ['2026-05-05|primary|republican', 'primary'],
      ['2026-11-03|general|', 'midterm_general'],
    ]);
  });
});

describe('concurrentTopOffice', () => {
  it('takes the first that applies', () => {
    expect(
      concurrentTopOffice([
        contest('ZZ', '2027-11-02', 'general', 'us-house'),
        contest('ZZ', '2027-11-02', 'general', 'governor', null, true),
      ]),
    ).toBe('governor');
    expect(
      concurrentTopOffice([
        contest('ZZ', '2027-11-02', 'general', 'city-council'),
        contest('ZZ', '2027-11-02', 'general', 'us-senate'),
      ]),
    ).toBe('federal');
    expect(
      concurrentTopOffice([
        contest('ZZ', '2027-11-02', 'general', 'state-senate'),
        contest('ZZ', '2027-11-02', 'general', 'state-treasurer', null, true),
      ]),
    ).toBe('statewide');
    expect(
      concurrentTopOffice([
        contest('ZZ', '2027-11-02', 'general', 'us-house'),
        contest('ZZ', '2027-11-02', 'general', 'state-house'),
      ]),
    ).toBe('legislature');
    expect(concurrentTopOffice([contest('ZZ', '2027-11-02', 'general', 'school-board')])).toBe(
      'local',
    );
  });
});
