import { assertNever, formatDate } from '@citizenrun/shared';
import type { OfficeSummary, PersonSummary, ResultView, TFunction } from '@citizenrun/shared';
import { illustrationFor } from '../art/office-art.tsx';
import type { CardContext, FeedCanvasOptions } from '../feed.ts';
import { officeSourceLines } from '../text/source-line.ts';
import { moneyText } from './figures.ts';
import { filingCount, officeFigures, officePay } from './office-facts.ts';
import {
  electionLineText,
  holderModel,
  kickerModel,
  officeTitleText,
  placeAltText,
  placeText,
} from './office-text.ts';
import type { BigNumberModel, FactModel, OfficeTopModel, SourceLines } from './region-models.ts';

// CARD-run-against (D-277, D-535): the model of the canvas for an office someone could run for, and
// its alt text as whole sentences.

/** What the canvas is built from. */
export type RunAgainstData = {
  office: OfficeSummary;
  /** The holder shown, or null. */
  featuredPerson: PersonSummary | null;
  /** The office's newest stage result; null where no feed item exists. */
  lastResult: ResultView | null;
};

export type RunAgainstModel = {
  top: OfficeTopModel;
  big: BigNumberModel;
  facts: [FactModel, FactModel];
  sources: SourceLines;
};

/** The most source lines a canvas has room for. */
const SOURCE_LINES_MAX = 2;

/** The source lines a canvas draws: pay, then filing, then votes only when one of the first two is missing. */
function canvasSourceLines(office: OfficeSummary, t: TFunction, ctx: CardContext): SourceLines {
  const lines = officeSourceLines(office, t, ctx);
  const lineOf = (field: 'pay' | 'filing' | 'votes'): string[] =>
    lines.filter((entry) => entry.field === field).map((entry) => entry.line);
  return [...lineOf('pay'), ...lineOf('filing'), ...lineOf('votes')].slice(0, SOURCE_LINES_MAX);
}

/** The model of the canvas. Pure: the day count comes from `ctx.now`, the photo from `options`. */
export function buildRunAgainstModel(
  data: RunAgainstData,
  t: TFunction,
  ctx: CardContext,
  options: FeedCanvasOptions,
): RunAgainstModel {
  const { office, featuredPerson } = data;
  const { big, facts } = officeFigures(office, t, ctx);
  return {
    top: {
      kicker: kickerModel(office, t),
      title: officeTitleText(office, t),
      place: placeText(office, t),
      electionLine: electionLineText(office, t, ctx),
      holder: holderModel(data, t),
      sticker: null,
      photoHref: featuredPerson === null ? null : options.photoHrefFor(featuredPerson),
      illustrationId: illustrationFor(office.officeTypeId),
    },
    big,
    facts,
    sources: canvasSourceLines(office, t, ctx),
  };
}

/** Sentence 1: the office and its place, as written. */
export function titleSentence(data: RunAgainstData, t: TFunction): string {
  return t('cards:alt.title', {
    office: data.office.title,
    place: placeAltText(data.office, t),
  });
}

/** Sentence 2: the open seat or the holder, with the name as written; null when there is neither. */
export function holderSentence(data: RunAgainstData, t: TFunction): string | null {
  const { office, featuredPerson } = data;
  if (office.openSeat !== null) {
    return t('cards:alt.openSeat');
  }
  if (featuredPerson === null) {
    return null;
  }
  return office.featuredHolderSince === null
    ? t('cards:alt.holder', { name: featuredPerson.name })
    : t('cards:alt.holderSince', {
        name: featuredPerson.name,
        year: office.featuredHolderSince.slice(0, 4),
      });
}

function paySentence(office: OfficeSummary, t: TFunction, ctx: CardContext): string {
  const pay = officePay(office);
  if (pay === null) {
    return t('cards:alt.unknown.pay');
  }
  const amount = moneyText(pay.cents, ctx);
  switch (pay.period) {
    case 'year':
      return pay.about ? t('cards:alt.pay_about', { amount }) : t('cards:alt.pay', { amount });
    case 'month':
      return pay.about
        ? t('cards:alt.payMonth_about', { amount })
        : t('cards:alt.payMonth', { amount });
    case 'meeting':
      return pay.about
        ? t('cards:alt.payMeeting_about', { amount })
        : t('cards:alt.payMeeting', { amount });
    case 'none':
      return t('cards:alt.payNone');
    default:
      return assertNever(pay.period);
  }
}

function votesSentence(office: OfficeSummary, t: TFunction): string {
  if (office.votesToWin === null) {
    return t('cards:alt.unknown.votes');
  }
  return office.votesEstimated === true
    ? t('cards:alt.votes_about', { count: office.votesToWin })
    : t('cards:alt.votes', { count: office.votesToWin });
}

/** The deadline sentence: a day count never goes without its date. */
function deadlineSentence(office: OfficeSummary, t: TFunction, ctx: CardContext): string {
  const filing = filingCount(office, ctx);
  switch (filing.kind) {
    case 'countable':
      return filing.days === 0
        ? t('cards:alt.deadlineToday')
        : t('cards:alt.deadlineOn', {
            count: filing.days,
            date: formatDate(filing.date, ctx.locale, 'weekday'),
          });
    case 'closed':
      return t('cards:alt.deadlineClosed');
    case 'noElection':
      return t('cards:alt.noElection');
    case 'unknown':
      return t('cards:alt.unknown.deadline');
    default:
      return assertNever(filing);
  }
}

/**
 * The alt text of the canvas as sentences, in order: the title, the holder when there is one, the
 * pay, the votes to win and the filing deadline. Each is one catalog sentence, and names are as
 * written, never folded.
 */
export function altTextSentences(data: RunAgainstData, t: TFunction, ctx: CardContext): string[] {
  const holder = holderSentence(data, t);
  return [
    titleSentence(data, t),
    ...(holder === null ? [] : [holder]),
    paySentence(data.office, t, ctx),
    votesSentence(data.office, t),
    deadlineSentence(data.office, t, ctx),
  ];
}

/** The alt text of the canvas: its sentences, one space apart. */
export function altText(data: RunAgainstData, t: TFunction, ctx: CardContext): string {
  return altTextSentences(data, t, ctx).join(' ');
}
