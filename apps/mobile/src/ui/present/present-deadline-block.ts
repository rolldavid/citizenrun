import {
  deadlineLabel,
  filingWindowState,
  formatDate,
  formatLocalTime,
  localDateTimeIn,
} from '@citizenrun/shared';
import type {
  ElectionView,
  FieldMeta,
  FilingTrack,
  FilingWindowInput,
  OfficeDetail,
  TFunction,
} from '@citizenrun/shared';
import type { CardContext } from '@citizenrun/cards';

import type { DeadlineBlockProps } from '@/ui/components/deadline-block';

import { sourceDomain, sourceLine } from './present-sources';

export type DeadlineInput = {
  /** The window's dates, its closing time and the zone they are read in (L-filing-window-state). */
  window: FilingWindowInput;
  /** The proof of the closing date; null when it has none. */
  proof: FieldMeta | null;
  conflict: ElectionView['deadlineConflict'];
  onOpenSource: () => void;
  itemKey: string;
  testID: string;
  sourceTestID: string;
};

type DeadlineData = Omit<DeadlineInput, 'onOpenSource' | 'itemKey' | 'testID' | 'sourceTestID'>;

/** The days left at which an open window is flagged (C-DeadlineBlock). */
const FLAG_FROM_DAYS = 7;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** An election's headline filing window, with the office's proof of the deadline. */
export function deadlineInputOfElection(
  election: ElectionView,
  office: Pick<OfficeDetail, 'fieldMeta' | 'jurisdiction'>,
): DeadlineData {
  return {
    window: {
      opensOn: election.filingOpens,
      closesOn: election.filingDeadline?.date ?? null,
      closesTime: election.filingDeadline?.time ?? null,
      zone: election.filingDeadline?.timezone ?? office.jurisdiction.timezone,
    },
    proof: office.fieldMeta.filingDeadline ?? null,
    conflict: election.deadlineConflict,
  };
}

/** One filing track's window, with the track's proof of its closing date. */
export function deadlineInputOfTrack(track: FilingTrack): DeadlineData {
  return {
    window: {
      opensOn: track.opensOn,
      closesOn: track.closesOn,
      closesTime: track.closesTime,
      zone: track.timezone,
    },
    proof: track.fieldMeta.closesOn ?? null,
    conflict: null,
  };
}

/** "Fri, Nov 27" in the current local year, "Nov 27, 2027" otherwise. */
export function deadlineDate(date: string, zone: string | null, ctx: CardContext): string {
  const thisYear = localDateTimeIn(zone, ctx.now).date.slice(0, 4);
  return formatDate(date, ctx.locale, date.slice(0, 4) === thisYear ? 'weekdayShort' : 'medium');
}

/** The closing date, with its hour only where a source states one; the hour is never converted (D-081). */
function closesLine(
  closesOn: string,
  window: FilingWindowInput,
  t: TFunction,
  ctx: CardContext,
): string {
  const date = deadlineDate(closesOn, window.zone, ctx);
  return window.closesTime === null
    ? t('common:deadline.closesOn', { date })
    : t('common:deadline.closesOnAt', {
        date,
        time: formatLocalTime(window.closesTime, window.zone, t),
      });
}

function linesOf(
  state: DeadlineBlockProps['state'],
  window: FilingWindowInput,
  t: TFunction,
  ctx: CardContext,
): string[] {
  const { opensOn, closesOn, zone } = window;
  // A window with no closing date is `unknown`, and has no date to print.
  if (state === 'unknown' || closesOn === null) {
    return [];
  }
  switch (state) {
    case 'open':
      return [closesLine(closesOn, window, t, ctx)];
    case 'not_open':
      return [
        ...(opensOn === null
          ? []
          : [t('common:deadline.opensOn', { date: deadlineDate(opensOn, zone, ctx) })]),
        closesLine(closesOn, window, t, ctx),
      ];
    case 'closed':
      return [t('common:deadline.closedOn', { date: deadlineDate(closesOn, zone, ctx) })];
  }
}

/**
 * The sentence of a deadline conflict: both dates, each with where it comes from. The entry about
 * the closing date when there is one, else the first; null when there is none, a value is missing,
 * or a value is not a calendar date.
 */
function conflictText(
  conflict: ElectionView['deadlineConflict'],
  zone: string | null,
  t: TFunction,
  ctx: CardContext,
): string | null {
  const entry = conflict?.find((each) => each.field === 'closes_on') ?? conflict?.[0];
  if (entry === undefined) {
    return null;
  }
  const { computed, scraped } = entry;
  if (computed.value === null || scraped.value === null) {
    return null;
  }
  if (!CALENDAR_DATE.test(computed.value) || !CALENDAR_DATE.test(scraped.value)) {
    return null;
  }
  const dates = {
    computed: deadlineDate(computed.value, zone, ctx),
    scraped: deadlineDate(scraped.value, zone, ctx),
  };
  const domain = sourceDomain(scraped.sourceUrl);
  if (domain === null) {
    return t('common:deadline.conflictPlain', dates);
  }
  return computed.ruleCitation === null
    ? t('common:deadline.conflictNoCitation', { ...dates, domain })
    : t('common:deadline.conflict', { ...dates, citation: computed.ruleCitation, domain });
}

/**
 * C-DeadlineBlock's props for one filing window at `ctx.now`: where the window stands, its dates,
 * the source row of its proof, the caution every state carries (D-515) and a conflict's sentence.
 */
export function presentDeadlineBlock(
  input: DeadlineInput,
  t: TFunction,
  ctx: CardContext,
): DeadlineBlockProps {
  const { window, proof } = input;
  const state = filingWindowState(window, ctx.now);
  const daysLeft = state.state === 'open' ? state.daysLeft : null;
  return {
    state: state.state,
    daysLeft,
    headline: deadlineLabel(state, window.zone, t),
    flagLabel:
      daysLeft !== null && daysLeft <= FLAG_FROM_DAYS
        ? t('common:deadline.flag', { count: daysLeft })
        : null,
    lines: linesOf(state.state, window, t, ctx),
    source:
      state.state === 'unknown' || proof === null
        ? null
        : {
            confidence: proof.confidence,
            text: sourceLine(proof, t, ctx),
            onPress: input.onOpenSource,
            testID: input.sourceTestID,
          },
    caution: t('common:confirmBeforeFiling'),
    conflict: conflictText(input.conflict, window.zone, t, ctx),
    itemKey: input.itemKey,
    testID: input.testID,
  };
}
