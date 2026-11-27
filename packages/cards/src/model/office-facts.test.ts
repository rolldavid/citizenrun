import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldMeta, OfficeSummary } from '@citizenrun/shared';
import { FIXTURE_CTX, FIXTURE_OFFICE } from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { deadlineOn, officeWith, t } from '../regions/testing/support.ts';
import { daysToFileFact, factMoneyText, officeFigures, officePay } from './office-facts.ts';
import type { BigNumberModel, FactModel } from './region-models.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const HIGH: FieldMeta = {
  sourceUrl: 'https://elections.wrencounty.example/budget-2026',
  quote: 'Fixture quote.',
  confidence: 'high',
  checkedAt: '2026-11-09T15:00:00Z',
  ruleCitation: null,
};
const LOW: FieldMeta = { ...HIGH, sourceUrl: null, quote: null, confidence: 'low' };

const NO_PAY: Partial<OfficeSummary> = {
  payAnnualCents: null,
  payKind: null,
  payAmountCents: null,
  payPeriod: null,
};
const NO_VOTES: Partial<OfficeSummary> = {
  votesToWin: null,
  votesLow: null,
  votesHigh: null,
  votesEstimated: null,
};
const NO_DEADLINE: Partial<OfficeSummary> = {
  filingDeadline: null,
  filingStatus: 'dates_not_known',
};

function figures(overrides: Partial<OfficeSummary>): {
  big: BigNumberModel;
  facts: [FactModel, FactModel];
} {
  return officeFigures(officeWith(overrides), t, FIXTURE_CTX);
}

function big(overrides: Partial<OfficeSummary>): BigNumberModel {
  return figures(overrides).big;
}

function days(overrides: Partial<OfficeSummary>): FactModel {
  return daysToFileFact(officeWith(overrides), t, FIXTURE_CTX);
}

describe('officeFigures', () => {
  it('big number order', () => {
    const known = figures({});
    expect(known.big).toEqual({
      kind: 'figure',
      value: '$52,900',
      aboutWord: null,
      caption: 'a year · about 20 hours a week',
    });
    expect(known.facts.map((fact) => fact.label)).toEqual(['Votes to win', 'Days to file']);

    const noPay = figures(NO_PAY);
    expect(noPay.big).toEqual({
      kind: 'figure',
      value: '2,100',
      aboutWord: 'about',
      caption: 'votes to win',
    });
    expect(noPay.facts[0]).toEqual({
      kind: 'phrase',
      phrase: 'not known yet',
      label: 'Pay',
      dateLine: null,
    });
    expect(noPay.facts[1].label).toBe('Days to file');

    const daysOnly = figures({ ...NO_PAY, ...NO_VOTES });
    expect(daysOnly.big).toEqual({
      kind: 'figure',
      value: '12',
      aboutWord: null,
      caption: 'days to file · closes Fri, Nov 27',
    });
    expect(daysOnly.facts).toEqual([
      { kind: 'phrase', phrase: 'not known yet', label: 'Pay', dateLine: null },
      { kind: 'phrase', phrase: 'not known yet', label: 'Votes to win', dateLine: null },
    ]);

    const nothing = figures({ ...NO_PAY, ...NO_VOTES, ...NO_DEADLINE });
    expect(nothing.big).toEqual({ kind: 'unknown', phrase: 'not known yet', caption: 'pay' });
    expect(nothing.facts).toEqual([
      { kind: 'phrase', phrase: 'not known yet', label: 'Votes to win', dateLine: null },
      { kind: 'phrase', phrase: 'not known yet', label: 'Days to file', dateLine: null },
    ]);

    // Filing that closed earlier today is not a count for the big slot.
    const closedToday = figures({
      ...NO_PAY,
      ...NO_VOTES,
      filingDeadline: deadlineOn('2026-11-15'),
      filingStatus: 'closed',
    });
    expect(closedToday.big).toEqual({ kind: 'unknown', phrase: 'not known yet', caption: 'pay' });
    expect(closedToday.facts).toEqual([
      { kind: 'phrase', phrase: 'not known yet', label: 'Votes to win', dateLine: null },
      { kind: 'phrase', phrase: 'closed', label: 'Filing', dateLine: null },
    ]);
  });

  it('pay captions', () => {
    expect(big({ fullTime: true }).caption).toBe('a year · full time');
    expect(big({}).caption).toBe('a year · about 20 hours a week');
    expect(big({ fieldMeta: { ...FIXTURE_OFFICE.fieldMeta, hoursPerWeek: HIGH } }).caption).toBe(
      'a year · 20 hours a week',
    );
    expect(big({ hoursPerWeek: null }).caption).toBe('a year');

    const monthly = big({
      payAnnualCents: null,
      payKind: 'stipend',
      payAmountCents: 60000,
      payPeriod: 'month',
    });
    expect(monthly).toMatchObject({ value: '$600', caption: 'a month' });

    // An amount per meeting is never made a yearly one.
    const perMeeting = big({
      payAnnualCents: null,
      payKind: 'per_meeting',
      payAmountCents: 10000,
      payPeriod: 'meeting',
      hoursPerWeek: 3,
      fieldMeta: { payAmountCents: HIGH, hoursPerWeek: HIGH },
    });
    expect(perMeeting).toMatchObject({
      value: '$100',
      aboutWord: null,
      caption: 'per meeting · 3 hours a week',
    });
    expect(
      big({
        payAnnualCents: null,
        payKind: 'per_meeting',
        payAmountCents: 10000,
        payPeriod: 'meeting',
        hoursPerWeek: null,
      }).caption,
    ).toBe('per meeting');

    const unpaid = big({
      payAnnualCents: null,
      payKind: 'none',
      payAmountCents: null,
      payPeriod: null,
      hoursPerWeek: null,
    });
    expect(unpaid).toMatchObject({ value: '$0', caption: 'unpaid' });
    expect(officePay(officeWith({ payKind: 'none', payAnnualCents: null }))).toMatchObject({
      cents: 0,
      period: 'none',
    });
  });

  it('compact only when too wide', () => {
    // Too wide after the estimate word at the smallest size: the one place a big figure is compact.
    expect(big({ payAnnualCents: 123456700, fieldMeta: { payAnnualCents: LOW } })).toMatchObject({
      value: '$1.2M',
      aboutWord: 'about',
    });
    expect(big({ payAnnualCents: 13100000 })).toMatchObject({ value: '$131,000' });

    expect(figures({ votesToWin: 12345 }).facts[0]).toMatchObject({ value: '12.3K' });
    expect(figures({ votesToWin: 9999 }).facts[0]).toMatchObject({ value: '9,999' });
    expect(factMoneyText(1000000, t, FIXTURE_CTX)).toBe('$10K');
    expect(factMoneyText(999900, t, FIXTURE_CTX)).toBe('$9,999');
  });

  it('days facts', () => {
    expect(days({ filingDeadline: deadlineOn('2026-11-20') })).toEqual({
      kind: 'figure',
      value: '5',
      aboutWord: null,
      label: 'Days to file',
      flag: true,
      dateLine: 'closes Fri, Nov 20',
    });
    expect(days({})).toMatchObject({ value: '12', flag: false, dateLine: 'closes Fri, Nov 27' });
    // From 330 days the date line has the year, not the weekday.
    expect(days({ filingDeadline: deadlineOn('2027-12-20') })).toMatchObject({
      value: '400',
      flag: false,
      dateLine: 'closes Dec 20, 2027',
    });
    expect(days({ filingDeadline: deadlineOn('2026-11-14') })).toEqual({
      kind: 'phrase',
      phrase: 'closed',
      label: 'Filing',
      dateLine: null,
    });
    expect(days({ filingDeadline: null, filingStatus: 'closed' })).toMatchObject({
      phrase: 'closed',
      label: 'Filing',
    });
    // The last day after the closing hour: the status is closed while the date is still today.
    expect(days({ filingDeadline: deadlineOn('2026-11-15'), filingStatus: 'closed' })).toEqual({
      kind: 'phrase',
      phrase: 'closed',
      label: 'Filing',
      dateLine: null,
    });
    expect(days({ filingDeadline: deadlineOn('2026-11-20'), filingStatus: 'closed' })).toEqual({
      kind: 'phrase',
      phrase: 'closed',
      label: 'Filing',
      dateLine: null,
    });
    expect(days({ filingDeadline: null, filingStatus: 'no_election' })).toEqual({
      kind: 'phrase',
      phrase: 'none set',
      label: 'Next election',
      dateLine: null,
    });
    expect(days(NO_DEADLINE)).toEqual({
      kind: 'phrase',
      phrase: 'not known yet',
      label: 'Days to file',
      dateLine: null,
    });
    expect(days({ filingDeadline: deadlineOn('2026-11-15') })).toMatchObject({
      value: '0',
      flag: true,
      label: 'Days to file',
    });
    expect(days({ filingDeadline: deadlineOn('2026-11-16') })).toMatchObject({
      value: '1',
      label: 'Day to file',
    });
  });

  it('the about word follows L-about', () => {
    // A proof at low confidence: the pay takes the word.
    expect(big({ fieldMeta: { payAnnualCents: LOW } })).toMatchObject({ aboutWord: 'about' });
    expect(big({ fieldMeta: { payAnnualCents: { ...HIGH, confidence: 'medium' } } })).toMatchObject(
      { aboutWord: null },
    );
    expect(big({ fieldMeta: { payAnnualCents: HIGH } })).toMatchObject({ aboutWord: null });
    // A value with no proof at all is no estimate.
    expect(big({ fieldMeta: {} })).toMatchObject({ aboutWord: null });
    // Votes take the word from their own flag, never from a proof.
    expect(figures({ votesEstimated: true }).facts[0]).toMatchObject({ aboutWord: 'about' });
    expect(figures({ votesEstimated: false }).facts[0]).toMatchObject({ aboutWord: null });
    expect(figures({ votesEstimated: null }).facts[0]).toMatchObject({ aboutWord: null });
    // A day count is exact, whatever the confidence of its deadline.
    expect(days({ fieldMeta: { filingDeadline: LOW } })).toMatchObject({ aboutWord: null });
  });
});
