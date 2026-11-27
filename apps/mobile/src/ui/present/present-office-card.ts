import {
  assertNever,
  filingWindowState,
  formatLocalTime,
  formatMoney,
  isAbout,
} from '@citizenrun/shared';
import type { FieldMeta, OfficeSummary, TFunction } from '@citizenrun/shared';
import { illustrationFor, issueMatchLine } from '@citizenrun/cards';
import type { CardContext } from '@citizenrun/cards';
import type { ReactElement } from 'react';

import type { OfficeEntry } from '@/lib/view-models/common.types';
import { closingLineText } from '@/ui/components/deadline-line';
import type { ClosingInput } from '@/ui/components/deadline-line';
import type { OfficeCardProps } from '@/ui/components/office-card';

import { issueShortName } from './issue-short-name';
import { deadlineDate } from './present-deadline-block';
import { presentRunSlot } from './present-run-slot';

/** What a card's caller knows that the office entry does not hold. */
export type OfficeCardContext = {
  /** Why the card is shown: a feed item's reason, or the line an office list words for itself. */
  reason: string;
  viewerIssueIds: readonly string[];
  onOpenSources: () => void;
  onOpenEffort: () => void;
  testID: string;
};

type Confidence = FieldMeta['confidence'];
type MeterInput = NonNullable<OfficeCardProps['ease']>;

/** The ease score from which an office is easier than most, and from which it is average (PC6B-04). */
const EASE_HIGH_FROM = 67;
const EASE_MEDIUM_FROM = 34;
/** Impact is high above this score, and medium from the lower one up to it. */
const IMPACT_HIGH_ABOVE = 50;
const IMPACT_MEDIUM_FROM = 25;

const CONFIDENCE_ORDER: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

function easePhrase(office: OfficeSummary, t: TFunction): string | null {
  const { ease, easeConfidence } = office;
  if (ease === null) {
    return null;
  }
  const about = isAbout(
    ease,
    easeConfidence === null ? null : { confidence: easeConfidence },
    null,
  );
  if (ease >= EASE_HIGH_FROM) {
    return about ? t('office:meter.ease.high_about') : t('office:meter.ease.high');
  }
  if (ease >= EASE_MEDIUM_FROM) {
    return about ? t('office:meter.ease.medium_about') : t('office:meter.ease.medium');
  }
  return about ? t('office:meter.ease.low_about') : t('office:meter.ease.low');
}

function impactPhrase(office: OfficeSummary, t: TFunction): string | null {
  const { impact } = office;
  if (impact === null) {
    return null;
  }
  // In single-issue mode the score is about the issue the viewer chose.
  const issueId =
    office.impactMode === 'single_issue' ? office.impactIssueId : office.headlineIssueId;
  if (issueId === null) {
    return t('office:meter.impact.none');
  }
  const issue = issueShortName(issueId, t);
  if (issue === null) {
    // An issue this build has no words for: the meter says so.
    return null;
  }
  if (impact > IMPACT_HIGH_ABOVE) {
    return t('office:meter.impact.high', { issue });
  }
  return impact >= IMPACT_MEDIUM_FROM
    ? t('office:meter.impact.medium', { issue })
    : t('office:meter.impact.low', { issue });
}

/** The closing line under the card, from the office's headline deadline at `ctx.now`. */
function closingLine(office: OfficeSummary, t: TFunction, ctx: CardContext): string {
  const deadline = office.filingDeadline;
  const zone = deadline?.timezone ?? office.jurisdiction.timezone;
  let state: ClosingInput['state'];
  if (office.filingStatus === 'no_election') {
    state = 'none';
  } else if (deadline === null) {
    // No date to name, whatever the status says.
    state = 'unknown';
  } else if (office.filingStatus === 'closed') {
    state = 'closed';
  } else {
    state = filingWindowState(
      { opensOn: null, closesOn: deadline.date, closesTime: deadline.time, zone },
      ctx.now,
    ).state;
  }
  return closingLineText(
    {
      state,
      date: deadline === null ? null : deadlineDate(deadline.date, zone, ctx),
      // A closing hour only where a source states one, in its own zone.
      time:
        deadline === null || deadline.time === null
          ? null
          : formatLocalTime(deadline.time, zone, t),
    },
    t,
  );
}

/** What it costs to file and to run; null when the fee is not known. The cost to run is always an estimate. */
function costLine(office: OfficeSummary, t: TFunction, ctx: CardContext): string | null {
  const { filingFeeCents, costToRunCents, signaturesRequired } = office;
  if (filingFeeCents === null) {
    return null;
  }
  const cost = costToRunCents === null ? null : formatMoney(costToRunCents, ctx.locale);
  if (filingFeeCents === 0) {
    return cost === null
      ? t('office:card.cost.noFee')
      : t('office:card.cost.noFeeAndRun_about', { cost });
  }
  const fee = formatMoney(filingFeeCents, ctx.locale);
  if (cost === null) {
    return t('office:card.cost.feeOnly', { fee });
  }
  return signaturesRequired === null
    ? t('office:card.cost.feeAndRun_about', { fee, cost })
    : t('office:card.cost.feeSignaturesAndRun_about', { fee, count: signaturesRequired, cost });
}

function sourceText(confidence: Confidence | null, t: TFunction): string {
  switch (confidence) {
    case 'high':
      return t('office:card.source.high');
    case 'medium':
      return t('office:card.source.medium');
    case 'low':
      return t('office:card.source.low');
    case null:
      return t('office:card.source.none');
    default:
      return assertNever(confidence);
  }
}

/** The lowest confidence among the proofs the card's canvas shows: pay and the filing deadline. */
function lowestConfidence(office: OfficeSummary): Confidence | null {
  const proofs = [
    office.fieldMeta.payAnnualCents ?? office.fieldMeta.payAmountCents,
    office.fieldMeta.filingDeadline,
  ];
  let lowest: Confidence | null = null;
  for (const proof of proofs) {
    if (
      proof !== undefined &&
      (lowest === null || CONFIDENCE_ORDER[proof.confidence] < CONFIDENCE_ORDER[lowest])
    ) {
      lowest = proof.confidence;
    }
  }
  return lowest;
}

/**
 * C-OfficeCard's props for an office in a list or the feed: the header's two lines, the action
 * row, the two meters once the office is scored, the closing line, the cost line and the source
 * row. The caller builds the canvas and fills `card`.
 */
export function presentOfficeCard(
  entry: OfficeEntry,
  canvas: { element: ReactElement; altText: string },
  t: TFunction,
  ctx: CardContext,
  card: OfficeCardContext,
): OfficeCardProps {
  const { office, actions, itemKey } = entry;
  // Scores arrive for both meters together; before scoring the card has no meter row.
  const scored = office.ease !== null || office.impact !== null;
  const meter = (name: string, score: number | null, phrase: string | null): MeterInput => ({
    name,
    score,
    phrase,
    onPress: card.onOpenEffort,
    itemKey,
  });
  const confidence = lowestConfidence(office);
  return {
    header: {
      illustration: illustrationFor(office.officeTypeId),
      reason: card.reason,
      match: issueMatchLine(office, card.viewerIssueIds, t),
    },
    canvas: canvas.element,
    altText: canvas.altText,
    href: entry.href,
    actions: {
      kind: 'office',
      layout: 'row',
      run: presentRunSlot(actions, t),
      following: actions.following,
      bookmarked: actions.bookmarked,
      onRun: actions.onRun,
      onToggleFollow: actions.onToggleFollow,
      onToggleBookmark: actions.onToggleBookmark,
      itemKey,
      testID: `${card.testID}-actions`,
    },
    ease: scored ? meter(t('office:meter.easeName'), office.ease, easePhrase(office, t)) : null,
    impact: scored
      ? meter(t('office:meter.impactName'), office.impact, impactPhrase(office, t))
      : null,
    closingLine: closingLine(office, t, ctx),
    costLine: costLine(office, t, ctx),
    source: {
      confidence,
      text: sourceText(confidence, t),
      onPress: card.onOpenSources,
    },
    // The card menu comes with the feed.
    onOpenMenu: null,
    itemKey,
    testID: card.testID,
  };
}
