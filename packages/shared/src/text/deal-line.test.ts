import { describe, expect, it } from 'vitest';
import { englishT } from '../i18n/format/english-t.fixtures.ts';
import { dealLine } from './deal-line.ts';
import type { DealInput } from './deal-line.ts';

const t = englishT();
const LOCALE = 'en';

const BASE: DealInput = {
  pay: { amountCents: 5_294_100, period: 'year', kind: 'salary', benefits: null, about: false },
  hours: { perWeek: 20, fullTime: false, about: false },
  impact: { level: 'high', issueName: 'Rent and housing costs' },
  votes: { value: 2_100, about: false },
};

function withPay(pay: Partial<DealInput['pay']>): DealInput {
  return { ...BASE, pay: { ...BASE.pay, ...pay } };
}

function withHours(hours: Partial<DealInput['hours']>): DealInput {
  return { ...BASE, hours: { ...BASE.hours, ...hours } };
}

function withVotes(votes: Partial<DealInput['votes']>): DealInput {
  return { ...BASE, votes: { ...BASE.votes, ...votes } };
}

function payOf(input: DealInput): string | undefined {
  return dealLine(input, t, LOCALE)[0];
}

function hoursOf(input: DealInput): string | undefined {
  return dealLine(input, t, LOCALE)[1];
}

function lastOf(input: DealInput): string | undefined {
  return dealLine(input, t, LOCALE).at(-1);
}

describe('dealLine pay', () => {
  it('kind none is unpaid', () => {
    expect(payOf(withPay({ kind: 'none', amountCents: null, period: null }))).toBe('Unpaid.');
  });

  it('amount 0 is unpaid', () => {
    expect(payOf(withPay({ amountCents: 0 }))).toBe('Unpaid.');
  });

  it('a null amount is not known', () => {
    expect(payOf(withPay({ amountCents: null }))).toBe('Pay not known yet.');
  });

  it('a year with benefits', () => {
    expect(payOf(withPay({ benefits: ['health'] }))).toBe('Pays $52,941 a year plus benefits.');
    expect(payOf(withPay({ benefits: ['health'], about: true }))).toBe(
      'Pays about $52,941 a year plus benefits.',
    );
  });

  it('a year with no benefits listed', () => {
    expect(payOf(withPay({ benefits: [] }))).toBe('Pays $52,941 a year.');
    expect(payOf(withPay({ benefits: null, about: true }))).toBe('Pays about $52,941 a year.');
  });

  it('a month', () => {
    expect(payOf(withPay({ amountCents: 30_000, period: 'month', kind: 'stipend' }))).toBe(
      'Pays $300 a month.',
    );
    expect(payOf(withPay({ amountCents: 30_000, period: 'month', about: true }))).toBe(
      'Pays about $300 a month.',
    );
  });

  it('a meeting', () => {
    expect(payOf(withPay({ amountCents: 10_000, period: 'meeting', kind: 'per_meeting' }))).toBe(
      'Pays $100 per meeting.',
    );
    expect(
      payOf(withPay({ amountCents: 10_000, period: 'meeting', kind: 'per_meeting', about: true })),
    ).toBe('Pays about $100 per meeting.');
  });

  it('a known amount without a period is not known', () => {
    expect(payOf(withPay({ amountCents: 30_000, period: null }))).toBe('Pay not known yet.');
  });

  it('cents are shown when the amount is not whole dollars', () => {
    expect(payOf(withPay({ amountCents: 3_750, period: 'meeting' }))).toBe(
      'Pays $37.50 per meeting.',
    );
  });

  it('a negative amount is refused', () => {
    expect(() => dealLine(withPay({ amountCents: -100 }), t, LOCALE)).toThrow(RangeError);
  });
});

describe('dealLine hours', () => {
  it('full-time', () => {
    expect(hoursOf(withHours({ fullTime: true, perWeek: 40 }))).toBe('Full-time.');
  });

  it('hours a week', () => {
    expect(hoursOf(withHours({ perWeek: 1 }))).toBe('1 hour a week.');
    expect(hoursOf(withHours({ perWeek: 20 }))).toBe('20 hours a week.');
  });

  it('about hours a week', () => {
    expect(hoursOf(withHours({ perWeek: 20, about: true }))).toBe('About 20 hours a week.');
    expect(hoursOf(withHours({ perWeek: 1, about: true }))).toBe('About 1 hour a week.');
  });

  it('hours not known', () => {
    expect(hoursOf(withHours({ perWeek: null, fullTime: null }))).toBe('Hours not known yet.');
    expect(hoursOf(withHours({ perWeek: null, fullTime: false }))).toBe('Hours not known yet.');
  });

  it('negative hours are refused', () => {
    expect(() => dealLine(withHours({ perWeek: -1 }), t, LOCALE)).toThrow(RangeError);
  });
});

describe('dealLine impact', () => {
  it('each level names the issue', () => {
    const line = (level: 'high' | 'medium' | 'low'): string | undefined =>
      dealLine({ ...BASE, impact: { level, issueName: 'Schools' } }, t, LOCALE)[2];
    expect(line('high')).toBe('High impact on Schools.');
    expect(line('medium')).toBe('Medium impact on Schools.');
    expect(line('low')).toBe('Low impact on Schools.');
  });

  it('impact level null gives no impact on your issues', () => {
    expect(dealLine({ ...BASE, impact: { level: null, issueName: null } }, t, LOCALE)[2]).toBe(
      'No impact on your issues.',
    );
  });

  it('impact null leaves the part out', () => {
    expect(dealLine({ ...BASE, impact: null }, t, LOCALE)).toEqual([
      'Pays $52,941 a year.',
      '20 hours a week.',
      '2,100 votes win it.',
    ]);
  });

  it('a level without an issue name is refused', () => {
    expect(() =>
      dealLine({ ...BASE, impact: { level: 'high', issueName: null } }, t, LOCALE),
    ).toThrow(RangeError);
  });
});

describe('dealLine votes', () => {
  it('votes', () => {
    expect(lastOf(withVotes({ value: 1 }))).toBe('1 vote wins it.');
    expect(lastOf(withVotes({ value: 2_100 }))).toBe('2,100 votes win it.');
  });

  it('about votes', () => {
    expect(lastOf(withVotes({ value: 2_100, about: true }))).toBe('About 2,100 votes win it.');
    expect(lastOf(withVotes({ value: 1, about: true }))).toBe('About 1 vote wins it.');
  });

  it('votes not known', () => {
    expect(lastOf(withVotes({ value: null }))).toBe('Votes to win not known yet.');
  });

  it('negative votes are refused', () => {
    expect(() => dealLine(withVotes({ value: -1 }), t, LOCALE)).toThrow(RangeError);
  });
});

describe('dealLine', () => {
  it('the D-517 example', () => {
    const lines = dealLine(
      {
        pay: {
          amountCents: 5_294_100,
          period: 'year',
          kind: 'salary',
          benefits: ['health'],
          about: false,
        },
        hours: { perWeek: 20, fullTime: false, about: true },
        impact: { level: 'high', issueName: 'Rent and housing costs' },
        votes: { value: 2_100, about: true },
      },
      t,
      LOCALE,
    );
    expect(lines.join(t('cards:deal.separator'))).toBe(
      'Pays $52,941 a year plus benefits. About 20 hours a week. High impact on Rent and housing costs. About 2,100 votes win it.',
    );
  });

  it('the separator is one space', () => {
    expect(t('cards:deal.separator')).toBe(' ');
  });

  it('everything not known', () => {
    expect(
      dealLine(
        {
          pay: { amountCents: null, period: null, kind: null, benefits: null, about: false },
          hours: { perWeek: null, fullTime: null, about: false },
          impact: null,
          votes: { value: null, about: false },
        },
        t,
        LOCALE,
      ),
    ).toEqual(['Pay not known yet.', 'Hours not known yet.', 'Votes to win not known yet.']);
  });
});
