import { describe, expect, it } from 'vitest';
import {
  checkAgainstTemplate,
  checkDateInRange,
  checkFee,
  checkHours,
  checkPay,
  checkSeats,
  checkSignatures,
  checkTerm,
  checkTrackDates,
} from './plausibility.ts';

const ELECTION = '2027-03-02';
const NO_DATES = { opens_on: null, closes_on: null, petition_opens: null, petition_due: null };
const NO_PAY = { pay_annual_cents: null, pay_amount_cents: null, pay_period: null };

describe('checkTrackDates', () => {
  it('closes_on on the election date passes and one day later fails', () => {
    expect(checkTrackDates({ ...NO_DATES, closes_on: '2027-03-02' }, ELECTION)).toBeNull();
    expect(checkTrackDates({ ...NO_DATES, closes_on: '2027-03-03' }, ELECTION)).toEqual({
      check: 'closes_before_election',
      detail: 'closes_on 2027-03-03 is after the election 2027-03-02',
    });
  });

  it('opens_on after closes_on fails, and on the same day passes', () => {
    expect(
      checkTrackDates({ ...NO_DATES, opens_on: '2026-12-10', closes_on: '2026-12-09' }, ELECTION)
        ?.check,
    ).toBe('opens_before_closes');
    expect(
      checkTrackDates({ ...NO_DATES, opens_on: '2026-12-09', closes_on: '2026-12-09' }, ELECTION),
    ).toBeNull();
  });

  it('petition_due after the election fails', () => {
    expect(checkTrackDates({ ...NO_DATES, petition_due: '2027-03-03' }, ELECTION)?.check).toBe(
      'petition_due_before_election',
    );
    expect(checkTrackDates({ ...NO_DATES, petition_due: '2027-03-02' }, ELECTION)).toBeNull();
  });

  it('petition_opens after petition_due fails', () => {
    expect(
      checkTrackDates(
        { ...NO_DATES, petition_opens: '2027-01-02', petition_due: '2027-01-01' },
        ELECTION,
      )?.check,
    ).toBe('petition_opens_before_due');
  });

  it('a null side skips its comparison', () => {
    expect(checkTrackDates({ ...NO_DATES, opens_on: '2028-01-01' }, ELECTION)).toBeNull();
    expect(checkTrackDates({ ...NO_DATES, petition_opens: '2028-01-01' }, ELECTION)).toBeNull();
    expect(checkTrackDates(NO_DATES, ELECTION)).toBeNull();
  });
});

describe('checkDateInRange', () => {
  const today = '2028-02-29';

  it('exactly five years before and after today pass, one day beyond fails', () => {
    expect(checkDateInRange('2023-02-28', today)).toBeNull();
    expect(checkDateInRange('2023-02-27', today)).toEqual({
      check: 'date_in_range',
      detail: '2023-02-27 is outside 2023-02-28 to 2033-02-28',
    });
    expect(checkDateInRange('2033-02-28', today)).toBeNull();
    expect(checkDateInRange('2033-03-01', today)?.check).toBe('date_in_range');
  });

  it('maps 29 February to 28 February in a year without it', () => {
    expect(checkDateInRange('2019-02-28', '2024-02-29')).toBeNull();
    expect(checkDateInRange('2019-02-27', '2024-02-29')?.check).toBe('date_in_range');
    expect(checkDateInRange('2029-02-28', '2024-02-29')).toBeNull();
    expect(checkDateInRange('2029-03-01', '2024-02-29')?.check).toBe('date_in_range');
  });

  it('a string that is not a calendar date fails', () => {
    expect(checkDateInRange('2027-02-30', today)?.check).toBe('date_in_range');
    expect(checkDateInRange('03/02/2027', today)?.check).toBe('date_in_range');
  });
});

describe('checkSeats', () => {
  it('seats 0 and 201 fail, 1 and 200 pass', () => {
    const seats = (n: number) => checkSeats({ seats: n, body_size: null, seats_up_next: null });
    expect(seats(0)?.check).toBe('seats');
    expect(seats(201)?.check).toBe('seats');
    expect(seats(1)).toBeNull();
    expect(seats(200)).toBeNull();
  });

  it('body_size 0 and 201 fail, 1 and 200 pass', () => {
    const body = (n: number) => checkSeats({ seats: null, body_size: n, seats_up_next: null });
    expect(body(0)?.check).toBe('body_size');
    expect(body(201)?.check).toBe('body_size');
    expect(body(1)).toBeNull();
    expect(body(200)).toBeNull();
  });

  it('seats_up_next 8 with body_size 7 fails, 7 passes', () => {
    expect(checkSeats({ seats: 7, body_size: 7, seats_up_next: 8 })).toEqual({
      check: 'seats_up_next',
      detail: 'seats_up_next 8 is above body_size 7',
    });
    expect(checkSeats({ seats: 7, body_size: 7, seats_up_next: 7 })).toBeNull();
  });
});

describe('checkAgainstTemplate', () => {
  it('a template seat count that differs fails', () => {
    expect(checkAgainstTemplate('seats', 9, 7)).toEqual({
      check: 'template_mismatch',
      detail: "seats 9 differs from the template's 7",
    });
    expect(checkAgainstTemplate('body_size', 7, 7)).toBeNull();
    expect(checkAgainstTemplate('seats', 9, null)).toBeNull();
  });
});

describe('checkPay', () => {
  it('annual pay 50,000,000 cents passes and 50,000,001 fails', () => {
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 50_000_000 }, null)).toBeNull();
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 50_000_001 }, null)?.check).toBe('pay_annual');
  });

  it('per meeting 500,000 passes and 500,001 fails', () => {
    const meeting = (cents: number) =>
      checkPay({ pay_annual_cents: null, pay_amount_cents: cents, pay_period: 'meeting' }, null);
    expect(meeting(500_000)).toBeNull();
    expect(meeting(500_001)?.check).toBe('pay_per_meeting');
    // The per-meeting bound applies only to a per-meeting amount.
    expect(
      checkPay({ pay_annual_cents: null, pay_amount_cents: 500_001, pay_period: 'month' }, null),
    ).toBeNull();
  });

  it('a template pay range overrides the generic bound', () => {
    const range = { min_cents: 1_000_000, max_cents: 60_000_000 };
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 55_000_000 }, range)).toBeNull();
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 60_000_000 }, range)).toBeNull();
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 1_000_000 }, range)).toBeNull();
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 999_999 }, range)?.check).toBe('pay_range');
    expect(checkPay({ ...NO_PAY, pay_annual_cents: 60_000_001 }, range)?.check).toBe('pay_range');
  });
});

describe('checkSignatures', () => {
  it('250,000 passes, 250,001 fails, 0 fails', () => {
    expect(checkSignatures(250_000, null)).toBeNull();
    expect(checkSignatures(250_001, null)?.check).toBe('signatures');
    expect(checkSignatures(0, null)?.check).toBe('signatures');
    expect(checkSignatures(1, null)).toBeNull();
  });

  it('a rule range overrides it', () => {
    const range = { min: 25, max: 300_000 };
    expect(checkSignatures(300_000, range)).toBeNull();
    expect(checkSignatures(24, range)?.check).toBe('signatures');
    expect(checkSignatures(300_001, range)?.check).toBe('signatures');
  });
});

describe('checkTerm, checkHours and checkFee', () => {
  it('term 15 passes, 16 fails, 0 fails', () => {
    expect(checkTerm(15)).toBeNull();
    expect(checkTerm(1)).toBeNull();
    expect(checkTerm(16)?.check).toBe('term_years');
    expect(checkTerm(0)?.check).toBe('term_years');
  });

  it('hours 80 passes, 80.5 fails, 0 fails', () => {
    expect(checkHours(80)).toBeNull();
    expect(checkHours(0.5)).toBeNull();
    expect(checkHours(80.5)?.check).toBe('hours_per_week');
    expect(checkHours(0)?.check).toBe('hours_per_week');
  });

  it('fee 10,000,000 passes, 10,000,001 fails, 0 passes', () => {
    expect(checkFee(10_000_000)).toBeNull();
    expect(checkFee(10_000_001)?.check).toBe('fee');
    expect(checkFee(0)).toBeNull();
    expect(checkFee(-1)?.check).toBe('fee');
  });
});
