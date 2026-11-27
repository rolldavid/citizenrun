import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'WA',
  source: {
    title: 'Washington elections calendar',
    url: 'https://www.sos.wa.gov/elections/calendar',
    retrievedOn: '2026-11-27',
    sha256: '479050a6bb9ffa27e9083259f0922f00ebd74b4a39ea9eb80847b5d77812ee9a',
  },
  contests: [],
  cases: [
    {
      id: 'wa-2027-filing-week',
      office: {
        templateKey: 'county-commissioner',
        officeTypeId: 'county-commission',
        schedule: 'wa_county_general',
        trackSet: 'wa_filing_week',
      },
      contest: { date: '2027-11-02', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2027-05-03',
          closesOn: '2027-05-07',
          withdrawalDeadline: '2027-05-10',
        },
      ],
      quote: 'Monday, May 03, 2027 Official Candidate Filing Week opens',
    },
  ],
};
