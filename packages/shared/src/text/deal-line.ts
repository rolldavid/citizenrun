import { formatMoney } from '../i18n/format/money.ts';
import type { TFunction } from '../i18n/format/t-function.ts';
import type { ImpactLevel } from '../scoring/impact-level.ts';

export type DealInput = {
  pay: {
    amountCents: number | null;
    period: 'year' | 'month' | 'meeting' | null;
    kind: 'salary' | 'stipend' | 'per_meeting' | 'none' | null;
    benefits: readonly string[] | null;
    about: boolean;
  };
  hours: { perWeek: number | null; fullTime: boolean | null; about: boolean };
  // Null when the office has no issue with a relevance above 0.
  impact: { level: ImpactLevel | null; issueName: string | null } | null;
  votes: { value: number | null; about: boolean };
};

function assertNotNegative(value: number): void {
  if (!(value >= 0)) {
    throw new RangeError('A deal value is never negative.');
  }
}

function payLine(pay: DealInput['pay'], t: TFunction, locale: string): string {
  const { amountCents, period, about } = pay;
  if (pay.kind === 'none' || amountCents === 0) {
    return t('cards:deal.payNone');
  }
  if (amountCents === null) {
    return t('cards:deal.payUnknown');
  }
  assertNotNegative(amountCents);
  switch (period) {
    case 'year': {
      const amount = formatMoney(amountCents, locale);
      if (pay.benefits !== null && pay.benefits.length > 0) {
        return about
          ? t('cards:deal.payYearBenefits_about', { amount })
          : t('cards:deal.payYearBenefits', { amount });
      }
      return about
        ? t('cards:deal.payYear_about', { amount })
        : t('cards:deal.payYear', { amount });
    }
    case 'month': {
      const amount = formatMoney(amountCents, locale);
      return about
        ? t('cards:deal.payMonth_about', { amount })
        : t('cards:deal.payMonth', { amount });
    }
    case 'meeting': {
      const amount = formatMoney(amountCents, locale);
      return about
        ? t('cards:deal.payMeeting_about', { amount })
        : t('cards:deal.payMeeting', { amount });
    }
    case null:
      // A known amount with no period is pay not known (L-deal-line).
      return t('cards:deal.payUnknown');
  }
}

function hoursLine(hours: DealInput['hours'], t: TFunction): string {
  if (hours.fullTime === true) {
    return t('cards:deal.fullTime');
  }
  if (hours.perWeek !== null) {
    assertNotNegative(hours.perWeek);
    return hours.about
      ? t('cards:deal.hours_about', { count: hours.perWeek })
      : t('cards:deal.hours', { count: hours.perWeek });
  }
  return t('cards:deal.hoursUnknown');
}

function impactLine(impact: NonNullable<DealInput['impact']>, t: TFunction): string {
  const { level, issueName } = impact;
  if (level === null) {
    return t('cards:deal.impactNone');
  }
  if (issueName === null) {
    throw new RangeError('An impact level needs its issue name.');
  }
  // The issue's stored name is data and is not translated.
  switch (level) {
    case 'high':
      return t('cards:deal.impactHigh', { issue: issueName });
    case 'medium':
      return t('cards:deal.impactMedium', { issue: issueName });
    case 'low':
      return t('cards:deal.impactLow', { issue: issueName });
  }
}

function votesLine(votes: DealInput['votes'], t: TFunction): string {
  if (votes.value === null) {
    return t('cards:deal.votesUnknown');
  }
  assertNotNegative(votes.value);
  // The count is passed as a number; the catalog's {{count, number}} formats it.
  return votes.about
    ? t('cards:deal.votes_about', { count: votes.value })
    : t('cards:deal.votes', { count: votes.value });
}

/**
 * The deal line's whole sentences, in order: pay, hours, impact (left out when `impact` is null)
 * and votes; a null value gives its not-known sentence. RangeError for a negative hours or votes
 * value, or an impact level with no issue name.
 */
export function dealLine(input: DealInput, t: TFunction, locale: string): string[] {
  const lines = [payLine(input.pay, t, locale), hoursLine(input.hours, t)];
  if (input.impact !== null) {
    lines.push(impactLine(input.impact, t));
  }
  lines.push(votesLine(input.votes, t));
  return lines;
}
