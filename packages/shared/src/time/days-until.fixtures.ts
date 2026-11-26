/** One row of the day-count fixture tables: a deadline, a zone and an instant. */
export type DaysUntilRow = {
  name: string;
  date: string;
  zone: string | null;
  now: string;
  local: string;
  days: number;
};

/** The eleven rows of L-days-until. */
export const DAYS_UNTIL_ROWS: readonly DaysUntilRow[] = [
  {
    name: 'row 1',
    date: '2027-03-05',
    zone: 'America/New_York',
    now: '2027-03-05T04:59:59Z',
    local: '2027-03-04 23:59',
    days: 1,
  },
  {
    name: 'row 2',
    date: '2027-03-05',
    zone: 'America/New_York',
    now: '2027-03-05T05:00:00Z',
    local: '2027-03-05 00:00',
    days: 0,
  },
  {
    name: 'row 3',
    date: '2027-03-05',
    zone: 'America/Los_Angeles',
    now: '2027-03-05T07:30:00Z',
    local: '2027-03-04 23:30',
    days: 1,
  },
  {
    name: 'row 4',
    date: '2027-03-05',
    zone: null,
    now: '2027-03-05T03:00:00Z',
    local: '2027-03-04 22:00',
    days: 1,
  },
  {
    name: 'row 5',
    date: '2027-03-01',
    zone: 'America/Chicago',
    now: '2027-03-05T12:00:00Z',
    local: '2027-03-05 06:00',
    days: -4,
  },
  {
    name: 'row 6',
    date: '2027-03-15',
    zone: 'America/Chicago',
    now: '2027-03-14T07:30:00Z',
    local: '2027-03-14 01:30',
    days: 1,
  },
  {
    name: 'row 7',
    date: '2027-08-05',
    zone: 'Pacific/Honolulu',
    now: '2027-08-03T09:00:00Z',
    local: '2027-08-02 23:00',
    days: 3,
  },
  {
    name: 'row 8',
    date: '2027-08-05',
    zone: 'Pacific/Guam',
    now: '2027-08-02T14:30:00Z',
    local: '2027-08-03 00:30',
    days: 2,
  },
  {
    name: 'row 9',
    date: '2027-12-13',
    zone: 'America/Chicago',
    now: '2027-11-15T12:00:00Z',
    local: '2027-11-15 06:00',
    days: 28,
  },
  {
    name: 'row 10',
    date: '2028-01-10',
    zone: 'Pacific/Pago_Pago',
    now: '2028-01-10T10:00:00Z',
    local: '2028-01-09 23:00',
    days: 1,
  },
  {
    name: 'row 11',
    date: '2027-03-05',
    zone: 'Not/AZone',
    now: '2027-03-05T03:00:00Z',
    local: '2027-03-04 22:00',
    days: 1,
  },
];

/** The five day-count cases of TEST-days-until. */
export const DAYS_UNTIL_CASES: readonly DaysUntilRow[] = [
  {
    name: "counts in the office's zone",
    date: '2027-03-01',
    zone: 'America/New_York',
    now: '2027-03-01T06:00:00Z',
    local: '2027-03-01 01:00',
    days: 0,
  },
  {
    name: 'a western office is still the day before',
    date: '2027-03-01',
    zone: 'America/Los_Angeles',
    now: '2027-03-01T06:00:00Z',
    local: '2027-02-28 22:00',
    days: 1,
  },
  {
    name: 'missing zone falls back to Eastern',
    date: '2027-03-01',
    zone: null,
    now: '2027-03-01T06:00:00Z',
    local: '2027-03-01 01:00',
    days: 0,
  },
  {
    name: 'passed',
    date: '2027-02-27',
    zone: 'America/New_York',
    now: '2027-03-01T15:00:00Z',
    local: '2027-03-01 10:00',
    days: -2,
  },
  {
    name: 'across a change to summer time',
    date: '2027-03-15',
    zone: 'America/New_York',
    now: '2027-03-14T05:30:00Z',
    local: '2027-03-14 00:30',
    days: 1,
  },
];
