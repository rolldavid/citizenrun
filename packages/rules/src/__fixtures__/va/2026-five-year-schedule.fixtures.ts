import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title:
      'Commonwealth of Virginia Schedule of General Elections, Department of Elections, 2026 2027 2028 2029 2030',
    url: 'https://www.elections.virginia.gov/media/boardpapers/calendar/Five_year_election_day_calendar-2026_2030.pdf',
    retrievedOn: '2026-11-27',
    sha256: '5b524a830ca3499d35bb4e0585e99393634d8b4f61b868c4dd6a20415e26a247',
  },
  contests: [
    {
      id: 'va-2027-state-senate-contests',
      office: {
        templateKey: 'state-senate',
        officeTypeId: 'state-senate',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2027,
      expect: [
        { date: '2027-06-15', kind: 'primary', party: 'democratic' },
        { date: '2027-06-15', kind: 'primary', party: 'republican' },
        { date: '2027-11-02', kind: 'general', party: null },
      ],
      quote:
        "NOVEMBER 2 Senate of Virginia (40) (4-year term) House of Delegates (100) (2-year term) Soil and Water Directors (4-year term) Counties: 4-year terms: *Commonwealth's Attorney *Sheriff Commissioner of Revenue *Treasurer County Board (Arlington County ONLY) Boards of Supervisors (94 counties) School Boards (93 counties) Cities: 8-year term: *Clerk of Court City Council (6 cities) (terms vary - set by Charter) City School Board (5 cities) (terms vary - set by Charter) Town Council (20 Towns) (terms vary – set by Charter) City or Town Mayor if required by Charter (terms vary - set by Charter) Primary if held: June 15",
    },
    {
      id: 'va-2027-state-house-contests',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2027,
      expect: [
        { date: '2027-06-15', kind: 'primary', party: 'democratic' },
        { date: '2027-06-15', kind: 'primary', party: 'republican' },
        { date: '2027-11-02', kind: 'general', party: null },
      ],
      quote:
        "NOVEMBER 2 Senate of Virginia (40) (4-year term) House of Delegates (100) (2-year term) Soil and Water Directors (4-year term) Counties: 4-year terms: *Commonwealth's Attorney *Sheriff Commissioner of Revenue *Treasurer County Board (Arlington County ONLY) Boards of Supervisors (94 counties) School Boards (93 counties) Cities: 8-year term: *Clerk of Court City Council (6 cities) (terms vary - set by Charter) City School Board (5 cities) (terms vary - set by Charter) Town Council (20 Towns) (terms vary – set by Charter) City or Town Mayor if required by Charter (terms vary - set by Charter) Primary if held: June 15",
    },
    {
      id: 'va-2027-sheriff-county-contests',
      office: {
        templateKey: 'sheriff',
        officeTypeId: 'sheriff',
        jurisdictionKind: 'county',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2027,
      expect: [
        { date: '2027-06-15', kind: 'primary', party: 'democratic' },
        { date: '2027-06-15', kind: 'primary', party: 'republican' },
        { date: '2027-11-02', kind: 'general', party: null },
      ],
      quote:
        "NOVEMBER 2 Senate of Virginia (40) (4-year term) House of Delegates (100) (2-year term) Soil and Water Directors (4-year term) Counties: 4-year terms: *Commonwealth's Attorney *Sheriff Commissioner of Revenue *Treasurer County Board (Arlington County ONLY) Boards of Supervisors (94 counties) School Boards (93 counties) Cities: 8-year term: *Clerk of Court City Council (6 cities) (terms vary - set by Charter) City School Board (5 cities) (terms vary - set by Charter) Town Council (20 Towns) (terms vary – set by Charter) City or Town Mayor if required by Charter (terms vary - set by Charter) Primary if held: June 15",
    },
    {
      id: 'va-2027-soil-water-contests',
      office: {
        templateKey: 'soil-water-conservation-board',
        officeTypeId: 'soil-water-conservation-board',
        schedule: 'va_november_general',
        trackSet: 'va_nonpartisan',
      },
      year: 2027,
      expect: [{ date: '2027-11-02', kind: 'general', party: null }],
      quote:
        "NOVEMBER 2 Senate of Virginia (40) (4-year term) House of Delegates (100) (2-year term) Soil and Water Directors (4-year term) Counties: 4-year terms: *Commonwealth's Attorney *Sheriff Commissioner of Revenue *Treasurer County Board (Arlington County ONLY) Boards of Supervisors (94 counties) School Boards (93 counties) Cities: 8-year term: *Clerk of Court City Council (6 cities) (terms vary - set by Charter) City School Board (5 cities) (terms vary - set by Charter) Town Council (20 Towns) (terms vary – set by Charter) City or Town Mayor if required by Charter (terms vary - set by Charter) Primary if held: June 15",
    },
    {
      id: 'va-2026-state-house-contests',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2026,
      expect: [],
      quote:
        'NOVEMBER 3 U. S. Senator (1) (6-year term) U. S. Representative (11) (2-year term) County Board (1 county) Arlington (4-year term) County School Board (3 counties) Alleghany (3-year term) Arlington (4-year term) Southampton At Large (3-year term) Central District ( 3-year term) Southwest District (1-year term) City Council (31 cities) (terms vary - set by Charter) City School Board (21 cities) (terms vary - set by Charter) Town Council (164 towns) (terms vary - set by Charter) Town School Board (2 towns) (terms vary - set by Charter) City or Town Mayor Town Treasurer Town Recorder (Clerk) if required by Charter (terms vary - set by Charter) Primary if held: August 4*',
    },
    {
      id: 'va-2028-us-house-contests',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2028,
      expect: [
        { date: '2028-06-20', kind: 'primary', party: 'democratic' },
        { date: '2028-06-20', kind: 'primary', party: 'republican' },
        { date: '2028-11-07', kind: 'general', party: null },
      ],
      quote:
        'NOVEMBER 7 President (4-year term) U. S. Representative (11) (2-year term) County Board (1 county) Arlington (4-year term) County School Board (1 county) Arlington (4-year term) City Council (32 cities) (terms vary - set by Charter) City School Board (22 cities) (terms vary - set by Charter) Town Council (153 towns) (terms vary - set by Charter) Town School Board (2 towns) (terms vary - set by Charter) City or Town Mayor Town Recorder (Clerk), if required by Charter (terms vary - set by Charter) Presidential Primary (if held: March 7) Primary - All Other Offices (if held: June 20)',
    },
    {
      id: 'va-2029-governor-contests',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2029,
      expect: [
        { date: '2029-06-19', kind: 'primary', party: 'democratic' },
        { date: '2029-06-19', kind: 'primary', party: 'republican' },
        { date: '2029-11-06', kind: 'general', party: null },
      ],
      quote:
        "NOVEMBER 6 Governor Lieutenant Governor Attorney General (4-year term) House of Delegates (100) (2-year term) Cities: 4-year terms: *Commonwealth's Attorney *Sheriff Commissioner of Revenue *Treasurer Counties: 4-year terms: County Board (Arlington County ONLY) Boards of Supervisors (60 counties) School Boards (61 counties) City Council (5 cities) (terms vary - set by Charter) City School Board (4 cities) (terms vary - set by Charter) Town Council (21 Towns) (terms vary – set by Charter) City or Town Mayor Town Recorder (Clerk), if required by Charter (terms vary - set by Charter) Primary if held: June 19",
    },
    {
      id: 'va-2029-sheriff-city-contests',
      office: {
        templateKey: 'sheriff',
        officeTypeId: 'sheriff',
        jurisdictionKind: 'city',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2029,
      expect: [
        { date: '2029-06-19', kind: 'primary', party: 'democratic' },
        { date: '2029-06-19', kind: 'primary', party: 'republican' },
        { date: '2029-11-06', kind: 'general', party: null },
      ],
      quote:
        "NOVEMBER 6 Governor Lieutenant Governor Attorney General (4-year term) House of Delegates (100) (2-year term) Cities: 4-year terms: *Commonwealth's Attorney *Sheriff Commissioner of Revenue *Treasurer Counties: 4-year terms: County Board (Arlington County ONLY) Boards of Supervisors (60 counties) School Boards (61 counties) City Council (5 cities) (terms vary - set by Charter) City School Board (4 cities) (terms vary - set by Charter) Town Council (21 Towns) (terms vary – set by Charter) City or Town Mayor Town Recorder (Clerk), if required by Charter (terms vary - set by Charter) Primary if held: June 19",
    },
    {
      id: 'va-2028-governor-contests',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2028,
      expect: [],
      quote:
        'NOVEMBER 7 President (4-year term) U. S. Representative (11) (2-year term) County Board (1 county) Arlington (4-year term) County School Board (1 county) Arlington (4-year term) City Council (32 cities) (terms vary - set by Charter) City School Board (22 cities) (terms vary - set by Charter) Town Council (153 towns) (terms vary - set by Charter) Town School Board (2 towns) (terms vary - set by Charter) City or Town Mayor Town Recorder (Clerk), if required by Charter (terms vary - set by Charter) Presidential Primary (if held: March 7) Primary - All Other Offices (if held: June 20)',
    },
  ],
  cases: [],
};
