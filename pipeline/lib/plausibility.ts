// PIPE-plausibility (P8-45): a value that fails is dropped and reported; it never becomes a stand-in.
// Every check is pure: it reads no clock, and `today` is an argument.

export type PlausibilityFailure = { check: string; detail: string };

/** Dates lie within this many calendar years of `today`, either side. // PIPE-plausibility */
export const DATE_RANGE_YEARS = 5;
/** Fewest seats and smallest body. // PIPE-plausibility */
export const SEATS_MIN = 1;
/** Most seats and largest body. // PIPE-plausibility */
export const SEATS_MAX = 200;
/** Highest annual pay without a template range: $500,000. // PIPE-plausibility */
export const PAY_ANNUAL_MAX_CENTS = 50_000_000;
/** Highest per-meeting amount without a template range: $5,000. // PIPE-plausibility */
export const PAY_PER_MEETING_MAX_CENTS = 500_000;
/** Fewest signatures without a rule range. // PIPE-plausibility */
export const SIGNATURES_MIN = 1;
/** Most signatures without a rule range. // PIPE-plausibility */
export const SIGNATURES_MAX = 250_000;
/** Shortest term in years. // PIPE-plausibility */
export const TERM_MIN_YEARS = 1;
/** Longest term in years. // PIPE-plausibility */
export const TERM_MAX_YEARS = 15;
/** Most hours a week; the least is anything above 0. // PIPE-plausibility */
export const HOURS_MAX = 80;
/** Lowest fee: no fee at all. // PIPE-plausibility */
export const FEE_MIN_CENTS = 0;
/** Highest fee: $100,000. // PIPE-plausibility */
export const FEE_MAX_CENTS = 10_000_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(check: string, detail: string): PlausibilityFailure {
  return { check, detail };
}

function parseIsoDate(date: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec(date);
  if (match === null) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** The same calendar day `years` away; 29 February becomes 28 February in a year without it. */
function shiftYears(date: { y: number; m: number; d: number }, years: number): string {
  const y = date.y + years;
  const d = Math.min(date.d, daysInMonth(y, date.m));
  return `${String(y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Deadlines before elections: each comparison runs only when both sides are known. */
export function checkTrackDates(
  track: {
    opens_on: string | null;
    closes_on: string | null;
    petition_opens: string | null;
    petition_due: string | null;
  },
  electionDate: string,
): PlausibilityFailure | null {
  if (track.closes_on !== null && track.closes_on > electionDate) {
    return fail(
      'closes_before_election',
      `closes_on ${track.closes_on} is after the election ${electionDate}`,
    );
  }
  if (track.opens_on !== null && track.closes_on !== null && track.opens_on > track.closes_on) {
    return fail(
      'opens_before_closes',
      `opens_on ${track.opens_on} is after closes_on ${track.closes_on}`,
    );
  }
  if (track.petition_due !== null && track.petition_due > electionDate) {
    return fail(
      'petition_due_before_election',
      `petition_due ${track.petition_due} is after the election ${electionDate}`,
    );
  }
  if (
    track.petition_opens !== null &&
    track.petition_due !== null &&
    track.petition_opens > track.petition_due
  ) {
    return fail(
      'petition_opens_before_due',
      `petition_opens ${track.petition_opens} is after petition_due ${track.petition_due}`,
    );
  }
  return null;
}

/** The date lies from `today` minus 5 years to `today` plus 5 years, both inclusive, by calendar years. */
export function checkDateInRange(date: string, today: string): PlausibilityFailure | null {
  const base = parseIsoDate(today);
  if (base === null) {
    throw new TypeError('today is not a calendar date');
  }
  if (parseIsoDate(date) === null) {
    return fail('date_in_range', `${date} is not a calendar date`);
  }
  const earliest = shiftYears(base, -DATE_RANGE_YEARS);
  const latest = shiftYears(base, DATE_RANGE_YEARS);
  if (date < earliest || date > latest) {
    return fail('date_in_range', `${date} is outside ${earliest} to ${latest}`);
  }
  return null;
}

function outside(n: number, min: number, max: number): boolean {
  return !Number.isFinite(n) || n < min || n > max;
}

/** `seats` and `body_size` from 1 to 200; `seats_up_next` at most `body_size`. */
export function checkSeats(o: {
  seats: number | null;
  body_size: number | null;
  seats_up_next: number | null;
}): PlausibilityFailure | null {
  if (o.seats !== null && outside(o.seats, SEATS_MIN, SEATS_MAX)) {
    return fail(
      'seats',
      `seats ${String(o.seats)} is outside ${String(SEATS_MIN)} to ${String(SEATS_MAX)}`,
    );
  }
  if (o.body_size !== null && outside(o.body_size, SEATS_MIN, SEATS_MAX)) {
    return fail(
      'body_size',
      `body_size ${String(o.body_size)} is outside ${String(SEATS_MIN)} to ${String(SEATS_MAX)}`,
    );
  }
  if (o.seats_up_next !== null && o.body_size !== null && o.seats_up_next > o.body_size) {
    return fail(
      'seats_up_next',
      `seats_up_next ${String(o.seats_up_next)} is above body_size ${String(o.body_size)}`,
    );
  }
  return null;
}

/** An extracted seat count that differs from a grounded template value is dropped. */
export function checkAgainstTemplate(
  field: 'seats' | 'body_size',
  extracted: number,
  templateValue: number | null,
): PlausibilityFailure | null {
  if (templateValue !== null && extracted !== templateValue) {
    return fail(
      'template_mismatch',
      `${field} ${String(extracted)} differs from the template's ${String(templateValue)}`,
    );
  }
  return null;
}

/**
 * With the template's `pay_range`, the annual pay lies within it; without one, annual pay is at
 * most $500,000 and a per-meeting amount at most $5,000.
 */
export function checkPay(
  p: {
    pay_annual_cents: number | null;
    pay_amount_cents: number | null;
    pay_period: 'year' | 'month' | 'meeting' | null;
  },
  payRange: { min_cents: number; max_cents: number } | null,
): PlausibilityFailure | null {
  if (payRange !== null) {
    if (
      p.pay_annual_cents !== null &&
      outside(p.pay_annual_cents, payRange.min_cents, payRange.max_cents)
    ) {
      return fail(
        'pay_range',
        `pay_annual_cents ${String(p.pay_annual_cents)} is outside ${String(payRange.min_cents)} to ${String(payRange.max_cents)}`,
      );
    }
    return null;
  }
  if (p.pay_annual_cents !== null && outside(p.pay_annual_cents, -Infinity, PAY_ANNUAL_MAX_CENTS)) {
    return fail(
      'pay_annual',
      `pay_annual_cents ${String(p.pay_annual_cents)} is above ${String(PAY_ANNUAL_MAX_CENTS)}`,
    );
  }
  if (
    p.pay_period === 'meeting' &&
    p.pay_amount_cents !== null &&
    outside(p.pay_amount_cents, -Infinity, PAY_PER_MEETING_MAX_CENTS)
  ) {
    return fail(
      'pay_per_meeting',
      `pay_amount_cents ${String(p.pay_amount_cents)} per meeting is above ${String(PAY_PER_MEETING_MAX_CENTS)}`,
    );
  }
  return null;
}

/** Within the rule's range when there is one; otherwise from 1 to 250,000. */
export function checkSignatures(
  n: number,
  range: { min: number; max: number } | null,
): PlausibilityFailure | null {
  const min = range === null ? SIGNATURES_MIN : range.min;
  const max = range === null ? SIGNATURES_MAX : range.max;
  if (outside(n, min, max)) {
    return fail(
      'signatures',
      `signatures ${String(n)} is outside ${String(min)} to ${String(max)}`,
    );
  }
  return null;
}

/** `term_years` from 1 to 15. */
export function checkTerm(years: number): PlausibilityFailure | null {
  if (outside(years, TERM_MIN_YEARS, TERM_MAX_YEARS)) {
    return fail(
      'term_years',
      `term_years ${String(years)} is outside ${String(TERM_MIN_YEARS)} to ${String(TERM_MAX_YEARS)}`,
    );
  }
  return null;
}

/** `hours_per_week` above 0 and at most 80. */
export function checkHours(h: number): PlausibilityFailure | null {
  if (!Number.isFinite(h) || h <= 0 || h > HOURS_MAX) {
    return fail(
      'hours_per_week',
      `hours_per_week ${String(h)} is not above 0 and at most ${String(HOURS_MAX)}`,
    );
  }
  return null;
}

/** A fee from $0 to $100,000. */
export function checkFee(cents: number): PlausibilityFailure | null {
  if (outside(cents, FEE_MIN_CENTS, FEE_MAX_CENTS)) {
    return fail(
      'fee',
      `fee ${String(cents)} cents is outside ${String(FEE_MIN_CENTS)} to ${String(FEE_MAX_CENTS)}`,
    );
  }
  return null;
}
