import type { RulesFixture } from '../../types.ts';

const SPRING_QUALIFYING =
  'the qualifying period for candidates for the spring primary election in 2026 and for all candidates for a party primary office to be elected in 2026, and those in any special primary election to be held at the same time, shall open on February 11, 2026.';

const US_SENATE = {
  templateKey: 'us-senate',
  officeTypeId: 'us-senate',
  schedule: 'la_party_primary_congressional',
  trackSet: 'la_party_primary',
} as const;
const PUBLIC_SERVICE_COMMISSION = {
  templateKey: 'public-service-commission',
  officeTypeId: 'utility-commission',
  schedule: 'la_party_primary_congressional',
  trackSet: 'la_party_primary',
} as const;
const SUPREME_COURT = {
  templateKey: 'supreme-court',
  officeTypeId: 'state-appellate-judge',
  schedule: 'la_party_primary_congressional',
  trackSet: 'la_party_primary',
} as const;

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title: 'RS 18:419.2, Spring elections in 2026',
    url: 'https://legis.la.gov/legis/LawPrint.aspx?d=1432545',
    retrievedOn: '2026-11-27',
    sha256: 'c1a8521182c2a120e1ead4b0bf462867468cb2ce3484b38c70d77b8c2167c072',
  },
  contests: [
    {
      id: 'la-2026-spring-city-council-contests',
      office: {
        templateKey: 'city-council',
        officeTypeId: 'city-council',
        schedule: 'la_municipal_spring',
        trackSet: 'la_qualifying',
      },
      year: 2026,
      expect: [
        { date: '2026-05-16', kind: 'primary', party: null },
        { date: '2026-06-27', kind: 'general', party: null },
      ],
      quote:
        'There shall be a spring primary election held on May 16, 2026, for municipal and ward officers elected in the spring of a nonpresidential congressional election year and for candidates in a party primary election for a party primary office to be elected in that year. Any contest, proposition, question, or constitutional amendment scheduled to appear on the ballot for the April 18, 2026, election shall instead appear on the ballot for the May 16, 2026, election. (2) There shall be a spring general election held on June 27, 2026, for municipal and ward officers',
    },
  ],
  cases: [
    {
      id: 'la-2026-spring-city-council-qualifying',
      office: {
        templateKey: 'city-council',
        officeTypeId: 'city-council',
        schedule: 'la_municipal_spring',
        trackSet: 'la_qualifying',
        population: 12_000,
      },
      contest: { date: '2026-05-16', kind: 'primary', party: null },
      expect: [{ track: 'nonpartisan', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
    {
      id: 'la-2026-us-senate-democratic-qualifying',
      office: US_SENATE,
      contest: { date: '2026-05-16', kind: 'primary', party: 'democratic' },
      expect: [{ track: 'party_primary', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
    {
      id: 'la-2026-us-senate-republican-qualifying',
      office: US_SENATE,
      contest: { date: '2026-05-16', kind: 'primary', party: 'republican' },
      expect: [{ track: 'party_primary', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
    {
      id: 'la-2026-us-senate-independent-qualifying',
      office: US_SENATE,
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', opensOn: '2026-02-11', petitionOpens: '2025-09-16' }],
      quote: `${SPRING_QUALIFYING} (2)(a) Notwithstanding R.S. 18:410.5 and 465(B) or any other provision of law to the contrary, any signature collected on or after September 16, 2025, on a nominating petition for an office for which qualifying opens on February 11, 2026, shall be considered timely.`,
    },
    {
      id: 'la-2026-public-service-commission-democratic-qualifying',
      office: PUBLIC_SERVICE_COMMISSION,
      contest: { date: '2026-05-16', kind: 'primary', party: 'democratic' },
      expect: [{ track: 'party_primary', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
    {
      id: 'la-2026-public-service-commission-independent-qualifying',
      office: PUBLIC_SERVICE_COMMISSION,
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
    {
      id: 'la-2026-supreme-court-republican-qualifying',
      office: SUPREME_COURT,
      contest: { date: '2026-05-16', kind: 'primary', party: 'republican' },
      expect: [{ track: 'party_primary', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
    {
      id: 'la-2026-supreme-court-independent-qualifying',
      office: SUPREME_COURT,
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', opensOn: '2026-02-11' }],
      quote: SPRING_QUALIFYING,
    },
  ],
};
