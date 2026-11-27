import { assertNever, daysUntil, formatDate, formatNumber, isAbout } from '@citizenrun/shared';
import type { OfficeSummary, TFunction } from '@citizenrun/shared';
import type { CardContext } from '../feed.ts';
import {
  compactCountText,
  compactMoneyText,
  countText,
  moneyText,
  overflowsBigSlot,
} from './figures.ts';
import type { BigNumberModel, FactModel } from './region-models.ts';

// The three numbers of an office canvas (CARD-run-against): pay, votes to win and days to file.
// The first that is known takes the big slot and the other two are the facts, in that order.

/** A fact figure is compact from this many up; a money fact from this many dollars. */
const FACT_COMPACT_FROM = 10_000;
/** A day count of this many or fewer puts its label on the flag. */
const FLAG_DAYS = 7;
/** From this many days the date line prints the year in place of the weekday. */
const YEAR_FROM_DAYS = 330;
const CENTS = 100;

/** What an office pays, per its period; `none` is an unpaid office. */
export type OfficePay = {
  cents: number;
  period: 'year' | 'month' | 'meeting' | 'none';
  /** True when the amount takes the estimate word. */
  about: boolean;
};

/**
 * The pay of an office, or null when it is not known. A yearly figure wins over an amount per
 * period, and an amount per meeting is never made a yearly one.
 */
export function officePay(office: OfficeSummary): OfficePay | null {
  const meta = office.fieldMeta;
  if (office.payKind === 'none') {
    const proof = meta.payAnnualCents ?? meta.payAmountCents ?? null;
    return { cents: 0, period: 'none', about: isAbout(0, proof, null) };
  }
  if (office.payAnnualCents !== null) {
    return {
      cents: office.payAnnualCents,
      period: 'year',
      about: isAbout(office.payAnnualCents, meta.payAnnualCents ?? null, null),
    };
  }
  if (office.payAmountCents !== null && office.payPeriod !== null) {
    return {
      cents: office.payAmountCents,
      period: office.payPeriod,
      about: isAbout(office.payAmountCents, meta.payAmountCents ?? null, null),
    };
  }
  return null;
}

/** Where an office's filing stands for a day count. */
export type FilingCount =
  | { kind: 'countable'; days: number; date: string }
  | { kind: 'closed' }
  | { kind: 'noElection' }
  | { kind: 'unknown' };

/**
 * The days left to file: countable when there is a deadline today or later; closed when filing has
 * closed or the deadline has passed; otherwise no election, or not known.
 */
export function filingCount(office: OfficeSummary, ctx: CardContext): FilingCount {
  const deadline = office.filingDeadline;
  if (deadline !== null) {
    const days = daysUntil(deadline.date, deadline.timezone, ctx.now);
    return days >= 0 ? { kind: 'countable', days, date: deadline.date } : { kind: 'closed' };
  }
  if (office.filingStatus === 'closed') {
    return { kind: 'closed' };
  }
  return office.filingStatus === 'no_election' ? { kind: 'noElection' } : { kind: 'unknown' };
}

/** A count as a fact figure: compact from 10,000. */
export function factCountText(n: number, t: TFunction, ctx: CardContext): string {
  return compactCountText(n, t, ctx);
}

/** An amount as a fact figure: compact from $10,000. */
export function factMoneyText(cents: number, t: TFunction, ctx: CardContext): string {
  return cents >= FACT_COMPACT_FROM * CENTS
    ? compactMoneyText(cents, t, ctx)
    : moneyText(cents, ctx);
}

/** The hours-a-week part of a pay caption: the hours as written, and whether they are an estimate. */
function hoursOf(
  office: OfficeSummary,
  ctx: CardContext,
): { hours: string; count: number; about: boolean } | null {
  const count = office.hoursPerWeek;
  if (count === null) {
    return null;
  }
  return {
    hours: formatNumber(count, ctx.locale, 1),
    count,
    about: isAbout(count, office.fieldMeta.hoursPerWeek ?? null, null),
  };
}

/** The caption under pay in the big slot: its period, and the hours a week when they are known. */
function payCaption(pay: OfficePay, office: OfficeSummary, t: TFunction, ctx: CardContext): string {
  const week = hoursOf(office, ctx);
  switch (pay.period) {
    case 'year':
      if (office.fullTime === true) {
        return t('cards:run.captionYearFullTime');
      }
      if (week === null) {
        return t('cards:run.captionYear');
      }
      return week.about
        ? t('cards:run.captionYearHours_about', { hours: week.hours, count: week.count })
        : t('cards:run.captionYearHours', { hours: week.hours, count: week.count });
    case 'month':
      return t('cards:run.captionMonth');
    case 'meeting':
      if (week === null) {
        return t('cards:run.captionMeeting');
      }
      return week.about
        ? t('cards:run.captionMeetingHours_about', { hours: week.hours, count: week.count })
        : t('cards:run.captionMeetingHours', { hours: week.hours, count: week.count });
    case 'none':
      if (week === null) {
        return t('cards:run.captionUnpaid');
      }
      return week.about
        ? t('cards:run.captionUnpaidHours_about', { hours: week.hours, count: week.count })
        : t('cards:run.captionUnpaidHours', { hours: week.hours, count: week.count });
    default:
      return assertNever(pay.period);
  }
}

/** A figure for the big slot: in full, or compact only when it is too wide at the smallest size. */
function bigFigure(
  full: string,
  compact: () => string,
  aboutWord: string | null,
  caption: string,
): BigNumberModel {
  return {
    kind: 'figure',
    value: overflowsBigSlot(full, aboutWord) ? compact() : full,
    aboutWord,
    caption,
  };
}

function aboutWordWhen(about: boolean, t: TFunction): string | null {
  return about ? t('common:about') : null;
}

/** Votes to win as a fact: the count, or the unknown phrase over the same label. */
function votesFact(office: OfficeSummary, t: TFunction, ctx: CardContext): FactModel {
  const label = t('cards:fact.votesToWin');
  if (office.votesToWin === null) {
    return { kind: 'phrase', phrase: t('common:notKnownYet'), label, dateLine: null };
  }
  return {
    kind: 'figure',
    value: factCountText(office.votesToWin, t, ctx),
    aboutWord: aboutWordWhen(office.votesEstimated === true, t),
    label,
    flag: false,
    dateLine: null,
  };
}

/**
 * Days to file as a fact: the count with its closing date, on the flag at seven days or fewer;
 * or "closed", "none set" or the unknown phrase when the days cannot be counted. A day count is
 * exact, so it never takes the estimate word, and it never appears without its date.
 */
export function daysToFileFact(office: OfficeSummary, t: TFunction, ctx: CardContext): FactModel {
  const filing = filingCount(office, ctx);
  switch (filing.kind) {
    case 'countable':
      return {
        kind: 'figure',
        value: countText(filing.days, ctx),
        aboutWord: null,
        label: t('cards:fact.daysToFile', { count: filing.days }),
        flag: filing.days <= FLAG_DAYS,
        dateLine:
          filing.days >= YEAR_FROM_DAYS
            ? t('cards:fact.closesYear', { date: formatDate(filing.date, ctx.locale, 'medium') })
            : t('cards:fact.closes', {
                date: formatDate(filing.date, ctx.locale, 'weekdayShort'),
              }),
      };
    case 'closed':
      return {
        kind: 'phrase',
        phrase: t('cards:fact.filingClosed'),
        label: t('cards:fact.filing'),
        dateLine: null,
      };
    case 'noElection':
      return {
        kind: 'phrase',
        phrase: t('cards:fact.noneSet'),
        label: t('cards:fact.nextElection'),
        dateLine: null,
      };
    case 'unknown':
      return {
        kind: 'phrase',
        phrase: t('common:notKnownYet'),
        label: t('cards:fact.daysToFile', { count: 0 }),
        dateLine: null,
      };
    default:
      return assertNever(filing);
  }
}

/**
 * The big number and the two facts of an office. Unknown is said once: when pay is not known the
 * next known number takes the big slot under a caption that names only itself, and pay is the
 * first fact, as unknown. With nothing known the big slot says so for pay.
 */
export function officeFigures(
  office: OfficeSummary,
  t: TFunction,
  ctx: CardContext,
): { big: BigNumberModel; facts: [FactModel, FactModel] } {
  const pay = officePay(office);
  const votes = votesFact(office, t, ctx);
  const days = daysToFileFact(office, t, ctx);
  if (pay !== null) {
    const { cents } = pay;
    return {
      big: bigFigure(
        moneyText(cents, ctx),
        () => compactMoneyText(cents, t, ctx),
        aboutWordWhen(pay.about, t),
        payCaption(pay, office, t, ctx),
      ),
      facts: [votes, days],
    };
  }
  const payUnknown: FactModel = {
    kind: 'phrase',
    phrase: t('common:notKnownYet'),
    label: t('cards:fact.pay'),
    dateLine: null,
  };
  const votesToWin = office.votesToWin;
  if (votesToWin !== null) {
    return {
      big: bigFigure(
        countText(votesToWin, ctx),
        () => compactCountText(votesToWin, t, ctx),
        aboutWordWhen(office.votesEstimated === true, t),
        t('cards:run.captionVotes'),
      ),
      facts: [payUnknown, days],
    };
  }
  const filing = filingCount(office, ctx);
  if (filing.kind === 'countable') {
    return {
      big: bigFigure(
        countText(filing.days, ctx),
        () => compactCountText(filing.days, t, ctx),
        null,
        t('cards:run.captionDays', {
          count: filing.days,
          date: formatDate(filing.date, ctx.locale, 'weekdayShort'),
        }),
      ),
      facts: [payUnknown, votes],
    };
  }
  return {
    big: {
      kind: 'unknown',
      phrase: t('common:notKnownYet'),
      caption: t('cards:run.captionPayOnly'),
    },
    facts: [votes, days],
  };
}
