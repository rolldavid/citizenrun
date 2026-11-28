import { buildOfficeHeroModel, heroAltText } from '@citizenrun/cards';
import type { CanvasColors, CardContext, OfficeTopModel } from '@citizenrun/cards';
import {
  assertNever,
  dealLine,
  filingWindowState,
  formatCompact,
  formatDate,
  formatLocalTime,
  formatMoney,
  formatNumber,
  isAbout,
  partyLabel,
  roundDiv,
} from '@citizenrun/shared';
import type {
  ElectionView,
  ErrorCode,
  FieldMeta,
  FieldReportField,
  FilingTrack,
  Issue,
  OfficeDetail,
  TFunction,
} from '@citizenrun/shared';

import type { OfficeReadyData } from '@/features/office/view-models/office.types';
import type { ActionRowProps } from '@/ui/components/action-row';
import type { BigNumberProps } from '@/ui/components/big-number';
import type { DeadlineBlockProps } from '@/ui/components/deadline-block';
import { closingLineText } from '@/ui/components/deadline-line';
import type { ClosingInput } from '@/ui/components/deadline-line';
import type { DealLineProps } from '@/ui/components/deal-line';
import type { FactRowProps } from '@/ui/components/fact-row';
import type { IssueChipProps } from '@/ui/components/issue-chip';
import type { MeterProps } from '@/ui/components/meter';
import { miniMapText } from '@/ui/components/mini-map-still';
import type { MiniMapStillProps } from '@/ui/components/mini-map-still';
import type { NoticeProps } from '@/ui/components/notice';
import type { PersonRowProps } from '@/ui/components/person-row';
import type { SourceLinkProps } from '@/ui/components/source-link';
import { toDisplayValue } from '@/ui/display-value';
import type { DisplayValue } from '@/ui/display-value';
import {
  deadlineDate,
  deadlineInputOfElection,
  formatList,
  issueShortName,
  presentDeadlineBlock,
  presentPersonRow,
  presentRunSlot,
  presentSources,
  sourceDomain,
  sourceLine,
} from '@/ui/present';
import type { SourceEntry } from '@/ui/present';

import { OFFICE_TEST_IDS } from './office-test-ids';

// SCR-office-slug: one presenter per block of the page. Each turns the office into the props its
// block lays out; none reads a clock, a hook or the screen.

/** The blocks of the page a control can scroll to. */
export type OfficeBlockId =
  | 'hero'
  | 'notices'
  | 'deal'
  | 'where'
  | 'pay'
  | 'controls'
  | 'budget'
  | 'holders'
  | 'board'
  | 'filing'
  | 'sources'
  | 'running';

/** What a block can open or move on the page. */
export type OfficePageActions = {
  openSources: (title: string, sources: readonly SourceEntry[]) => void;
  openSteps: () => void;
  openReport: () => void;
  scrollToBlock: (id: OfficeBlockId) => void;
};

/** A fact row with the key it is listed by. */
export type Fact = FactRowProps & { key: string };

type Proofs = Readonly<Record<string, FieldMeta | undefined>>;
type Confidence = FieldMeta['confidence'];
type PayPeriod = NonNullable<OfficeDetail['payPeriod']>;
type FitsDayJob = NonNullable<OfficeDetail['fitsDayJob']>;
type MeetingTime = NonNullable<OfficeDetail['meetingTimes']>[number];
type Benefit = NonNullable<OfficeDetail['benefits']>[number];
type Power = OfficeDetail['powers'][number];

const CONFIDENCE_ORDER: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

/** From this many cents the pay figure is written compact, and from this many the budget is. */
const PAY_COMPACT_FROM_CENTS = 10_000_000;
const BUDGET_COMPACT_FROM_CENTS = 100_000_000;
const CENTS_PER_DOLLAR = 100;

/** Every field a proof of the page can stand behind, in the order the sources section lists them. */
const PAGE_FIELDS = [
  'payAmountCents',
  'payAnnualCents',
  'payKind',
  'payPeriod',
  'benefits',
  'hoursPerWeek',
  'fullTime',
  'meetingTimes',
  'payChangeNote',
  'termYears',
  'termLimitTerms',
  'budget',
  'seats',
  'bodySize',
  'seatsUpNext',
  'partisan',
  'partySelection',
  'electorateCount',
  'filingDeadline',
  'filingFeeCents',
  'signaturesRequired',
  'whereToFile',
  'electionDate',
] as const;

// ---------------------------------------------------------------------------------------------------
// Labels and proofs

/** The name of a field, by its camelCase name; a name this build does not know is shown as sent. */
export function fieldLabel(field: string, t: TFunction): string {
  // One literal call per field, so the catalog check can read every key.
  switch (field) {
    case 'title':
      return t('office:field.title');
    case 'seats':
      return t('office:field.seats');
    case 'bodySize':
      return t('office:field.bodySize');
    case 'seatsUpNext':
      return t('office:field.seatsUpNext');
    case 'termYears':
      return t('office:field.termYears');
    case 'termLimitTerms':
      return t('office:field.termLimitTerms');
    case 'partisan':
      return t('office:field.partisan');
    case 'payAnnualCents':
      return t('office:field.payAnnualCents');
    case 'payKind':
      return t('office:field.payKind');
    case 'payAmountCents':
      return t('office:field.payAmountCents');
    case 'payPeriod':
      return t('office:field.payPeriod');
    case 'payChangeNote':
      return t('office:field.payChangeNote');
    case 'benefits':
      return t('office:field.benefits');
    case 'hoursPerWeek':
      return t('office:field.hoursPerWeek');
    case 'fullTime':
      return t('office:field.fullTime');
    case 'meetingTimes':
      return t('office:field.meetingTimes');
    case 'filingFeeCents':
      return t('office:field.filingFeeCents');
    case 'signaturesRequired':
      return t('office:field.signaturesRequired');
    case 'whereToFile':
      return t('office:field.whereToFile');
    case 'eligibility':
      return t('office:field.eligibility');
    case 'electionDate':
      return t('office:field.electionDate');
    case 'filingOpens':
      return t('office:field.filingOpens');
    case 'filingDeadline':
      return t('office:field.filingDeadline');
    case 'petitionDue':
      return t('office:field.petitionDue');
    case 'fitsDayJob':
      return t('office:field.fitsDayJob');
    case 'termPayCents':
      return t('office:field.termPayCents');
    case 'effectiveHourlyCents':
      return t('office:field.effectiveHourlyCents');
    case 'budget':
      return t('office:field.budget');
    case 'partySelection':
      return t('office:field.partySelection');
    case 'electorateCount':
      return t('office:field.electorateCount');
    default:
      return field;
  }
}

/** The name of a field a report can be about (L-field-report-fields). */
export function reportFieldLabel(field: FieldReportField, t: TFunction): string {
  switch (field) {
    case 'title':
      return fieldLabel('title', t);
    case 'seats':
      return fieldLabel('seats', t);
    case 'body_size':
      return fieldLabel('bodySize', t);
    case 'seats_up_next':
      return fieldLabel('seatsUpNext', t);
    case 'term_years':
      return fieldLabel('termYears', t);
    case 'term_limit_terms':
      return fieldLabel('termLimitTerms', t);
    case 'partisan':
      return fieldLabel('partisan', t);
    case 'pay_annual_cents':
      return fieldLabel('payAnnualCents', t);
    case 'pay_kind':
      return fieldLabel('payKind', t);
    case 'pay_amount_cents':
      return fieldLabel('payAmountCents', t);
    case 'pay_period':
      return fieldLabel('payPeriod', t);
    case 'pay_change_note':
      return fieldLabel('payChangeNote', t);
    case 'benefits':
      return fieldLabel('benefits', t);
    case 'hours_per_week':
      return fieldLabel('hoursPerWeek', t);
    case 'full_time':
      return fieldLabel('fullTime', t);
    case 'meeting_times':
      return fieldLabel('meetingTimes', t);
    case 'filing_fee_cents':
      return fieldLabel('filingFeeCents', t);
    case 'signatures_required':
      return fieldLabel('signaturesRequired', t);
    case 'where_to_file':
      return fieldLabel('whereToFile', t);
    case 'eligibility':
      return fieldLabel('eligibility', t);
    case 'election_date':
      return fieldLabel('electionDate', t);
    case 'filing_opens':
      return fieldLabel('filingOpens', t);
    case 'filing_deadline':
      return fieldLabel('filingDeadline', t);
    case 'petition_due':
      return fieldLabel('petitionDue', t);
    default:
      return assertNever(field);
  }
}

/**
 * Every proof of the page, by field: the office's own, the budget's and the election date's. A
 * value that is not known has no entry.
 */
export function pageFieldMeta(office: OfficeDetail): Proofs {
  const { budget, nextElectionDetail } = office;
  const electionDate = nextElectionDetail?.electionDateMeta ?? null;
  return {
    ...office.fieldMeta,
    ...(budget.cents === null || budget.meta === null ? {} : { budget: budget.meta }),
    ...(electionDate === null ? {} : { electionDate }),
  };
}

/** The least sure of the proofs a derived value stands on; null when it stands on none. */
function weakest(...proofs: readonly (FieldMeta | null | undefined)[]): FieldMeta | null {
  let least: FieldMeta | null = null;
  for (const proof of proofs) {
    if (proof === null || proof === undefined) {
      continue;
    }
    if (least === null || CONFIDENCE_ORDER[proof.confidence] < CONFIDENCE_ORDER[least.confidence]) {
      least = proof;
    }
  }
  return least;
}

/** Words drawn as written. "About" stands before a number, never before a sentence, a name or a date. */
function words(text: string | null): DisplayValue {
  return { text, about: false };
}

/** The sheet entries of the given fields: one per distinct source, none for a field with no proof. */
function entriesFor(
  proofs: Proofs,
  fields: readonly string[],
  t: TFunction,
  ctx: CardContext,
): SourceEntry[] {
  return presentSources(
    proofs,
    fields.map((field) => ({ field, label: fieldLabel(field, t) })),
    t,
    ctx,
  );
}

/** A section's source rows: one per entry, each opening the sheet with all of the section's. */
function sourceRows(
  entries: readonly SourceEntry[],
  section: 'pay' | 'budget' | 'filing',
  t: TFunction,
  page: OfficePageActions,
): SourceLinkProps[] {
  return entries.map((entry, index) => ({
    confidence: entry.confidence,
    text: entry.line,
    onPress: () => {
      page.openSources(t('office:sources.title'), entries);
    },
    testID: `${OFFICE_TEST_IDS.sourceLink}-${section}-${String(index + 1)}`,
  }));
}

/** A fact row of the page. A known value with a proof opens that proof. */
function fact(
  field: string,
  label: string,
  value: DisplayValue,
  sources: readonly SourceEntry[],
  page: OfficePageActions,
): Fact {
  const row = { key: field, label, value, testID: `${OFFICE_TEST_IDS.field}-${field}` };
  if (value.text === null || sources.length === 0) {
    return row;
  }
  return {
    ...row,
    onPress: () => {
      page.openSources(label, sources);
    },
  };
}

function unique(fields: readonly string[]): string[] {
  return [...new Set(fields)];
}

// ---------------------------------------------------------------------------------------------------
// Block 1: the hero

export type HeroProps = { model: OfficeTopModel; altText: string; colors: CanvasColors };

/** CARD-office-hero: the top of the office's canvas and the sentence that stands for it. */
export function presentHero(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
  colors: CanvasColors,
): HeroProps {
  const data = { office, featuredPerson: office.featuredOfficeholder, lastResult: null };
  return {
    // The photo slot is off, so the holder is a name beside the drawing.
    model: buildOfficeHeroModel(data, t, ctx, { stickerAllowed: false, photoHrefFor: () => null }),
    altText: heroAltText(data, t, ctx),
    colors,
  };
}

// ---------------------------------------------------------------------------------------------------
// Block 2: the standing notices

export type OfficeNotice = NoticeProps & { key: string; testID: string };

type ActOnField = 'pay' | 'filingFee' | 'signatures' | 'whereToFile' | 'filingDeadline';

function actOnName(field: ActOnField, t: TFunction): string {
  switch (field) {
    case 'pay':
      return t('office:notice.minimalField.pay');
    case 'filingFee':
      return t('office:notice.minimalField.filingFee');
    case 'signatures':
      return t('office:notice.minimalField.signatures');
    case 'whereToFile':
      return t('office:notice.minimalField.whereToFile');
    case 'filingDeadline':
      return t('office:notice.minimalField.filingDeadline');
    default:
      return assertNever(field);
  }
}

/** The act-on values of an office that are not known, in the order the notice names them. */
function unknownActOnFields(office: OfficeDetail): ActOnField[] {
  const missing: ActOnField[] = [];
  if (office.payAnnualCents === null && office.payAmountCents === null) {
    missing.push('pay');
  }
  // A fee of 0 is known.
  if (office.filingFeeCents === null) {
    missing.push('filingFee');
  }
  if (office.signaturesRequired === null) {
    missing.push('signatures');
  }
  if (office.whereToFile === null) {
    missing.push('whereToFile');
  }
  if (office.filingDeadline === null) {
    missing.push('filingDeadline');
  }
  return missing;
}

/** The notices that stand under the hero, in their fixed order. */
export function presentNotices(
  office: OfficeDetail,
  t: TFunction,
  onOpenSource: (url: string) => void,
): OfficeNotice[] {
  const notices: OfficeNotice[] = [];
  const idOf = (kind: string): string => `${OFFICE_TEST_IDS.notice}-${kind}`;
  if (office.retiredAt !== null) {
    notices.push({
      key: 'retired',
      kind: 'warning',
      text: t('office:notice.retired'),
      testID: idOf('retired'),
    });
  }
  if (office.placeholder) {
    const { website } = office.jurisdiction;
    notices.push({
      key: 'placeholder',
      kind: 'info',
      text: t('office:notice.placeholder'),
      testID: idOf('placeholder'),
      ...(website === null
        ? {}
        : {
            action: {
              label: t('office:notice.clerk'),
              onPress: () => {
                onOpenSource(website);
              },
              testID: OFFICE_TEST_IDS.noticeClerk,
            },
          }),
    });
  } else if (office.completeness === 'minimal') {
    const missing = unknownActOnFields(office);
    if (missing.length > 0) {
      const fields = formatList(
        missing.map((field) => actOnName(field, t)),
        t,
      );
      notices.push({
        key: 'minimal',
        kind: 'info',
        text: t('office:notice.minimal', { fields }),
        testID: idOf('minimal'),
      });
    }
  }
  if (office.filingStatus === 'no_election') {
    notices.push({
      key: 'no-election',
      kind: 'info',
      text: t('office:notice.noElection'),
      testID: idOf('no-election'),
    });
  }
  if (office.filingStatus === 'closed') {
    notices.push({
      key: 'closed',
      kind: 'info',
      text: t('office:notice.closed'),
      testID: idOf('closed'),
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------
// Block 3: the deal

type Pay = {
  cents: number | null;
  period: PayPeriod | null;
  /** The field whose proof stands behind the amount. */
  field: 'payAmountCents' | 'payAnnualCents';
  proof: FieldMeta | null;
};

/**
 * The pay the page states: the amount with its own period, else the yearly figure. A yearly figure
 * also stands in for an amount whose period is not known, so no amount is given a period it was
 * not sent with.
 */
function payOf(office: OfficeDetail): Pay {
  const { payAmountCents, payAnnualCents, payPeriod, fieldMeta } = office;
  if (payAmountCents !== null && (payPeriod !== null || payAnnualCents === null)) {
    return {
      cents: payAmountCents,
      period: payPeriod,
      field: 'payAmountCents',
      proof: fieldMeta.payAmountCents ?? null,
    };
  }
  if (payAnnualCents !== null) {
    return {
      cents: payAnnualCents,
      period: 'year',
      field: 'payAnnualCents',
      proof: fieldMeta.payAnnualCents ?? null,
    };
  }
  return { cents: null, period: null, field: 'payAmountCents', proof: null };
}

/** The deal in whole sentences: pay, then hours (L-deal-line). Pay opens the pay section. */
export function presentDeal(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
  page: Pick<OfficePageActions, 'scrollToBlock'>,
): DealLineProps['parts'] {
  const pay = payOf(office);
  const [payText, hoursText] = dealLine(
    {
      pay: {
        amountCents: pay.cents,
        period: pay.period,
        kind: office.payKind,
        benefits: office.benefits,
        about: isAbout(pay.cents, pay.proof, null),
      },
      hours: {
        perWeek: office.hoursPerWeek,
        fullTime: office.fullTime,
        about: isAbout(office.hoursPerWeek, office.fieldMeta.hoursPerWeek ?? null, null),
      },
      impact: null,
      votes: { value: null, about: false },
    },
    t,
    ctx.locale,
  );
  const parts: DealLineProps['parts'][number][] = [];
  if (payText !== undefined) {
    const figure = pay.cents === null ? null : formatMoney(pay.cents, ctx.locale);
    // Only a sentence that states the figure opens the section that explains it.
    parts.push(
      figure !== null && payText.includes(figure)
        ? {
            id: 'pay',
            text: payText,
            figure,
            onPress: () => {
              page.scrollToBlock('pay');
            },
          }
        : { id: 'pay', text: payText },
    );
  }
  if (hoursText !== undefined) {
    parts.push({ id: 'hours', text: hoursText });
  }
  return parts;
}

/** The name an issue is shown by: its short name, else the name it is stored with, else its id. */
function issueName(issueId: string, issues: readonly Issue[], t: TFunction): string {
  return (
    issueShortName(issueId, t) ??
    issues.find((issue) => issue.id === issueId)?.name ??
    issueId.replaceAll('-', ' ')
  );
}

/** The office's issues as small chips: display only, or a choice of one in single-issue mode. */
export function presentIssueChips(
  office: OfficeDetail,
  issues: readonly Issue[],
  singleIssue: OfficeReadyData['singleIssue'],
  t: TFunction,
): IssueChipProps[] {
  return office.issueRelevance.map(({ issueId }) => {
    const stored = issues.find((issue) => issue.id === issueId)?.name;
    const chip: IssueChipProps = {
      issueId,
      name: issueName(issueId, issues, t),
      size: 'sm',
      testID: `${OFFICE_TEST_IDS.issue}-${issueId}`,
      ...(stored === undefined ? {} : { label: stored }),
    };
    if (singleIssue === null) {
      return chip;
    }
    return {
      ...chip,
      selected: singleIssue.issueId === issueId,
      onPress: () => {
        singleIssue.onSelect(issueId);
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Block 4: where it is

export type WhereProps = { map: MiniMapStillProps; membersLine: string | null };

export function presentWhere(
  office: OfficeDetail,
  mapRow: OfficeReadyData['mapRow'],
  t: TFunction,
): WhereProps {
  return {
    map: {
      outline: office.outline,
      placeName: office.district.name,
      ...miniMapText(office.district, t),
      onPress: mapRow.onOpen,
      testID: OFFICE_TEST_IDS.miniMap,
    },
    membersLine: office.electorate === 'members' ? t('office:electorate.members') : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Block 5: pay and time

export type PayProps = {
  figure:
    { kind: 'unpaid'; text: string; testID: string } | { kind: 'number'; number: BigNumberProps };
  rows: Fact[];
  sources: SourceLinkProps[];
};

/** A sum of money in whole dollars, compact: "$174K". */
function compactMoney(cents: number, t: TFunction, ctx: CardContext): string {
  return t('office:money.compact', {
    amount: formatCompact(roundDiv(cents, CENTS_PER_DOLLAR), ctx.locale, t),
  });
}

/** The pay figure: whole below $100,000, compact from there, so it fits the narrowest measure. */
export function formatPayFigure(cents: number, t: TFunction, ctx: CardContext): string {
  return cents < PAY_COMPACT_FROM_CENTS
    ? formatMoney(cents, ctx.locale)
    : compactMoney(cents, t, ctx);
}

/** The budget figure: whole below $1,000,000, compact from there. */
export function formatBudgetFigure(cents: number, t: TFunction, ctx: CardContext): string {
  return cents < BUDGET_COMPACT_FROM_CENTS
    ? formatMoney(cents, ctx.locale)
    : compactMoney(cents, t, ctx);
}

function payPeriodLabel(period: PayPeriod | null, t: TFunction): string {
  switch (period) {
    case 'year':
      return t('office:pay.periodYear');
    case 'month':
      return t('office:pay.periodMonth');
    case 'meeting':
      return t('office:pay.periodMeeting');
    case null:
      return t('office:pay.label');
    default:
      return assertNever(period);
  }
}

/** The whole sentence a screen reader hears in place of the pay figure and its label. */
function paySentence(period: PayPeriod | null, value: DisplayValue, t: TFunction): string {
  if (value.text === null) {
    return t('office:pay.a11yUnknown');
  }
  const said = { amount: value.text };
  switch (period) {
    case 'year':
      return value.about ? t('office:pay.a11yYear_about', said) : t('office:pay.a11yYear', said);
    case 'month':
      return value.about ? t('office:pay.a11yMonth_about', said) : t('office:pay.a11yMonth', said);
    case 'meeting':
      return value.about
        ? t('office:pay.a11yMeeting_about', said)
        : t('office:pay.a11yMeeting', said);
    case null:
      return value.about ? t('office:pay.a11y_about', said) : t('office:pay.a11y', said);
    default:
      return assertNever(period);
  }
}

function benefitWord(benefit: Benefit, t: TFunction): string {
  switch (benefit) {
    case 'health':
      return t('office:benefit.health');
    case 'retirement':
      return t('office:benefit.retirement');
    case 'other':
      return t('office:benefit.other');
    default:
      return assertNever(benefit);
  }
}

function meetingWord(time: MeetingTime, t: TFunction): string {
  switch (time) {
    case 'daytime':
      return t('office:pay.meeting.daytime');
    case 'evenings':
      return t('office:pay.meeting.evenings');
    case 'weekends':
      return t('office:pay.meeting.weekends');
    default:
      return assertNever(time);
  }
}

/** Whether the office fits around a job, with when it meets where that is known. */
function fitsText(fits: FitsDayJob, times: readonly MeetingTime[] | null, t: TFunction): string {
  if (times === null || times.length === 0) {
    switch (fits) {
      case 'yes':
        return t('office:pay.fits.yes');
      case 'likely':
        return t('office:pay.fits.likely');
      case 'no':
        return t('office:pay.fits.no');
      default:
        return assertNever(fits);
    }
  }
  const said = {
    times: formatList(
      times.map((time) => meetingWord(time, t)),
      t,
    ),
  };
  switch (fits) {
    case 'yes':
      return t('office:pay.fitsWith.yes', said);
    case 'likely':
      return t('office:pay.fitsWith.likely', said);
    case 'no':
      return t('office:pay.fitsWith.no', said);
    default:
      return assertNever(fits);
  }
}

function benefitsText(benefits: readonly Benefit[] | null, t: TFunction): string | null {
  if (benefits === null) {
    return null;
  }
  return benefits.length === 0
    ? t('office:pay.noBenefits')
    : formatList(
        benefits.map((benefit) => benefitWord(benefit, t)),
        t,
      );
}

/** Pay and time: the pay stated large once, then the facts, then the section's sources. */
export function presentPay(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
  page: OfficePageActions,
): PayProps {
  const proofs = pageFieldMeta(office);
  const meta = office.fieldMeta;
  const pay = payOf(office);
  const unpaid = office.payKind === 'none';
  const figureId = `${OFFICE_TEST_IDS.field}-payAmountCents`;

  let figure: PayProps['figure'];
  if (unpaid) {
    figure = { kind: 'unpaid', text: t('office:pay.unpaid'), testID: figureId };
  } else {
    const value = toDisplayValue({ value: pay.cents, meta: pay.proof }, (cents) =>
      formatPayFigure(cents, t, ctx),
    );
    figure = {
      kind: 'number',
      number: {
        value,
        label: payPeriodLabel(pay.period, t),
        size: 'hero',
        itemKey: `office:${office.id}:pay`,
        accessibilityLabel: paySentence(pay.period, value, t),
        testID: figureId,
      },
    };
  }

  // The fields whose proofs the section stands on, in the order its rows are drawn.
  const used: string[] = [unpaid ? 'payKind' : pay.field];
  const rows: Fact[] = [];
  const add = (field: string, value: DisplayValue, proofFields: readonly string[]): void => {
    used.push(...proofFields);
    rows.push(
      fact(field, fieldLabel(field, t), value, entriesFor(proofs, proofFields, t, ctx), page),
    );
  };

  if (office.fullTime === true) {
    add('hoursPerWeek', words(t('office:pay.fullTime')), ['fullTime']);
  } else {
    add(
      'hoursPerWeek',
      toDisplayValue({ value: office.hoursPerWeek, meta: meta.hoursPerWeek ?? null }, (count) =>
        t('office:pay.hoursValue', { count }),
      ),
      ['hoursPerWeek'],
    );
  }
  add(
    'termYears',
    toDisplayValue({ value: office.termYears, meta: meta.termYears ?? null }, (count) =>
      t('office:pay.termValue', { count }),
    ),
    ['termYears'],
  );
  add('benefits', words(benefitsText(office.benefits, t)), ['benefits']);
  // Derived from the hours and the meeting times, whose proofs are its own.
  add(
    'fitsDayJob',
    words(office.fitsDayJob === null ? null : fitsText(office.fitsDayJob, office.meetingTimes, t)),
    ['hoursPerWeek', 'meetingTimes'],
  );
  add(
    'termPayCents',
    toDisplayValue(
      { value: office.termPayCents, meta: weakest(pay.proof, meta.termYears) },
      (cents) => formatMoney(cents, ctx.locale),
    ),
    [pay.field, 'termYears'],
  );
  // Drawn only where it is known: an office with no hours has no rate to show.
  if (office.effectiveHourlyCents !== null) {
    add(
      'effectiveHourlyCents',
      toDisplayValue(
        { value: office.effectiveHourlyCents, meta: weakest(pay.proof, meta.hoursPerWeek) },
        (cents) => t('office:pay.hourlyValue', { amount: formatMoney(cents, ctx.locale) }),
      ),
      [pay.field, 'hoursPerWeek'],
    );
  }
  add('payChangeNote', words(office.payChangeNote), ['payChangeNote']);
  add(
    'termLimitTerms',
    toDisplayValue({ value: office.termLimitTerms, meta: meta.termLimitTerms ?? null }, (count) =>
      t('office:pay.termLimitValue', { count }),
    ),
    ['termLimitTerms'],
  );

  return {
    figure,
    rows,
    sources: sourceRows(entriesFor(proofs, unique(used), t, ctx), 'pay', t, page),
  };
}

// ---------------------------------------------------------------------------------------------------
// Block 6: what it controls

export type PowerRow = {
  key: string;
  title: string;
  /** How far the office decides this; null for a relevance this build has no words for. */
  relevance: string | null;
  description: string;
  tiles: { issueId: string; label: string }[];
  onPress: () => void;
  testID: string;
};

export type ControlsProps = { rows: PowerRow[]; none: string | null };

function relevanceWords(relevance: Power['relevance'], t: TFunction): string | null {
  switch (relevance) {
    case 3:
      return t('office:relevance.decides');
    case 2:
      return t('office:relevance.shares');
    case 1:
      return t('office:relevance.indirect');
    default:
      return null;
  }
}

/** The sheet entry of one power: its quote and its link. */
function powerSource(power: Power, t: TFunction, ctx: CardContext): SourceEntry {
  const domain = sourceDomain(power.sourceUrl);
  // A power checked at no known time has no date to print: its line names the source alone.
  const line =
    power.checkedAt === null
      ? (domain ?? power.name)
      : sourceLine(
          {
            sourceUrl: power.sourceUrl,
            quote: power.quote,
            confidence: power.confidence,
            checkedAt: power.checkedAt,
            ruleCitation: null,
          },
          t,
          ctx,
        );
  return {
    id: power.powerId,
    covers: power.name,
    line,
    confidence: power.confidence,
    quote: power.quote,
    url: domain === null ? null : power.sourceUrl,
    domain,
  };
}

export function presentControls(
  office: OfficeDetail,
  issues: readonly Issue[],
  t: TFunction,
  ctx: CardContext,
  page: Pick<OfficePageActions, 'openSources'>,
): ControlsProps {
  const rows = office.powers.map((power): PowerRow => {
    const source = powerSource(power, t, ctx);
    return {
      key: power.powerId,
      title: power.name,
      relevance: relevanceWords(power.relevance, t),
      description: power.description,
      tiles: power.issueIds.map((issueId) => ({
        issueId,
        label: issueName(issueId, issues, t),
      })),
      onPress: () => {
        page.openSources(power.name, [source]);
      },
      testID: `${OFFICE_TEST_IDS.power}-${power.powerId}`,
    };
  });
  return { rows, none: rows.length === 0 ? t('office:controls.none') : null };
}

// ---------------------------------------------------------------------------------------------------
// Block 7: the budget

export type BudgetProps = { number: BigNumberProps; sources: SourceLinkProps[] };

export function presentBudget(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
  page: OfficePageActions,
): BudgetProps {
  const { budget } = office;
  const value = toDisplayValue({ value: budget.cents, meta: budget.meta }, (cents) =>
    formatBudgetFigure(cents, t, ctx),
  );
  let said: string;
  if (value.text === null) {
    said = t('office:budget.a11yUnknown');
  } else {
    said = value.about
      ? t('office:budget.a11y_about', { amount: value.text })
      : t('office:budget.a11y', { amount: value.text });
  }
  return {
    number: {
      value,
      // A year is a name, not a count: it is printed as written.
      label:
        budget.year === null
          ? t('office:budget.labelNoYear')
          : t('office:budget.label', { year: String(budget.year) }),
      size: 'display',
      itemKey: `office:${office.id}:budget`,
      accessibilityLabel: said,
      testID: `${OFFICE_TEST_IDS.field}-budget`,
    },
    sources: sourceRows(entriesFor(pageFieldMeta(office), ['budget'], t, ctx), 'budget', t, page),
  };
}

// ---------------------------------------------------------------------------------------------------
// Blocks 10 and 11: who holds it, and the board

export type HoldersProps = { rows: PersonRowProps[]; none: string | null };

/** Every holder as the same row, in the order sent. */
export function presentHolders(
  office: OfficeDetail,
  officeholders: OfficeReadyData['officeholders'],
  t: TFunction,
  ctx: CardContext,
): HoldersProps {
  const rows = officeholders.map(({ holder, entry }) =>
    presentPersonRow(
      {
        kind: 'holder',
        entry,
        partisan: office.partisan,
        since: holder.since,
        seatLabel: holder.seatLabel,
        testID: `${OFFICE_TEST_IDS.holder}-${holder.person.id}`,
      },
      t,
      ctx,
    ),
  );
  return { rows, none: rows.length === 0 ? t('office:holder.none') : null };
}

/** The board's seats, its majority and its split by party; null for an office that is no board. */
export function presentBoard(office: OfficeDetail, t: TFunction): Fact[] | null {
  const board = office.boardControl;
  if (board === null) {
    return null;
  }
  const idOf = (part: string): string => `${OFFICE_TEST_IDS.field}-${part}`;
  const { bodySize } = board;
  const rows: Fact[] = [
    {
      key: 'seatsUpNext',
      label: t('office:board.seatsUpLabel'),
      value: toDisplayValue(
        { value: board.seatsUpNext, meta: office.fieldMeta.seatsUpNext ?? null },
        (up) =>
          bodySize === null
            ? t('office:board.seatsUpNoSize', { up })
            : t('office:board.seatsUp', { up, size: bodySize }),
      ),
      testID: idOf('seatsUpNext'),
    },
    {
      key: 'majority',
      label: t('office:board.majorityLabel'),
      value: words(
        board.majority === null ? null : t('office:board.majority', { count: board.majority }),
      ),
      testID: idOf('majority'),
    },
  ];
  for (const { party, count } of board.partySplit ?? []) {
    rows.push({
      key: `party-${party ?? 'none'}`,
      label: party === null ? t('office:board.noParty') : partyLabel(party, t),
      value: words(t('office:board.members', { count })),
      testID: idOf(`party-${party ?? 'none'}`),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// Block 12: filing

export type FilingProps = {
  /** A party seat filled at a caucus or a meeting: the sentence in the deadline's place. */
  partySeat: { sentence: string; quote: string | null; source: SourceLinkProps | null } | null;
  /** A party seat chosen on the primary ballot: the line above the deadline. */
  primaryBallotLine: string | null;
  /** Null only for a seat that is not filled by filing. */
  deadline: DeadlineBlockProps | null;
  rows: Fact[];
  sources: SourceLinkProps[];
  steps: { label: string; onPress: () => void; testID: string } | null;
};

function partySeatOf(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
  page: OfficePageActions,
): FilingProps['partySeat'] {
  let sentence: string;
  switch (office.partySelection) {
    case 'caucus':
      sentence = t('office:partySelection.caucus');
      break;
    case 'party_meeting':
      sentence = t('office:partySelection.partyMeeting');
      break;
    case 'primary_ballot':
    case null:
      return null;
    default:
      return assertNever(office.partySelection);
  }
  const proof = office.fieldMeta.partySelection ?? null;
  const entries = entriesFor(pageFieldMeta(office), ['partySelection'], t, ctx);
  const title = fieldLabel('partySelection', t);
  return {
    sentence,
    quote:
      proof === null || proof.quote === null
        ? null
        : t('common:ui.sources.quote', { quote: proof.quote }),
    source:
      proof === null
        ? null
        : {
            confidence: proof.confidence,
            text: sourceLine(proof, t, ctx),
            onPress: () => {
              page.openSources(title, entries);
            },
            testID: `${OFFICE_TEST_IDS.sourceLink}-filing-1`,
          },
  };
}

/** Filing: the deadline with its four parts, the facts a person acts on, and the way to the steps. */
export function presentFiling(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
  page: OfficePageActions,
): FilingProps {
  const proofs = pageFieldMeta(office);
  const meta = office.fieldMeta;
  const election = office.nextElectionDetail;
  const partySeat = partySeatOf(office, t, ctx, page);
  const deadlineLabel = fieldLabel('filingDeadline', t);
  const deadlineEntries = entriesFor(proofs, ['filingDeadline'], t, ctx);

  const deadlineIds = {
    itemKey: `office:${office.id}:deadline`,
    testID: `${OFFICE_TEST_IDS.field}-filingDeadline`,
    sourceTestID: `${OFFICE_TEST_IDS.sourceLink}-deadline`,
    onOpenSource: () => {
      page.openSources(deadlineLabel, deadlineEntries);
    },
  };
  let deadline: DeadlineBlockProps | null = null;
  if (partySeat === null) {
    deadline = presentDeadlineBlock(
      election === null
        ? {
            // No election: nothing of the window is known.
            window: {
              opensOn: null,
              closesOn: null,
              closesTime: null,
              zone: office.jurisdiction.timezone,
            },
            proof: null,
            conflict: null,
            ...deadlineIds,
          }
        : { ...deadlineInputOfElection(election, office), ...deadlineIds },
      t,
      ctx,
    );
  }

  const electionDate = office.nextElection?.electionDate ?? null;
  const rows: Fact[] = [
    fact(
      'filingFeeCents',
      fieldLabel('filingFeeCents', t),
      toDisplayValue({ value: office.filingFeeCents, meta: meta.filingFeeCents ?? null }, (cents) =>
        // No fee is a known value, and reads as words.
        cents === 0 ? t('office:filing.noFee') : formatMoney(cents, ctx.locale),
      ),
      entriesFor(proofs, ['filingFeeCents'], t, ctx),
      page,
    ),
    fact(
      'signaturesRequired',
      fieldLabel('signaturesRequired', t),
      toDisplayValue(
        { value: office.signaturesRequired, meta: meta.signaturesRequired ?? null },
        (count) => formatNumber(count, ctx.locale),
      ),
      entriesFor(proofs, ['signaturesRequired'], t, ctx),
      page,
    ),
    fact(
      'whereToFile',
      fieldLabel('whereToFile', t),
      words(office.whereToFile),
      entriesFor(proofs, ['whereToFile'], t, ctx),
      page,
    ),
    fact(
      'electionDate',
      fieldLabel('electionDate', t),
      // A date that stands alone is still a catalog string, so a language can set it its own way.
      words(
        electionDate === null
          ? null
          : t('office:filing.electionDay', {
              date: formatDate(electionDate, ctx.locale, 'weekday'),
            }),
      ),
      entriesFor(proofs, ['electionDate'], t, ctx),
      page,
    ),
  ];

  // The source row of the deadline, or of a party seat's sentence, stands above the rows; a row is
  // drawn here only for another source.
  let shownLink: string | null = null;
  if (deadline?.source != null) {
    shownLink = meta.filingDeadline?.sourceUrl ?? null;
  } else if (partySeat?.source != null) {
    shownLink = meta.partySelection?.sourceUrl ?? null;
  }
  const others = entriesFor(
    proofs,
    ['filingFeeCents', 'signaturesRequired', 'whereToFile'],
    t,
    ctx,
  ).filter((entry) => entry.url === null || entry.url !== shownLink);

  return {
    partySeat,
    primaryBallotLine:
      office.partySelection === 'primary_ballot' ? t('office:partySelection.primaryBallot') : null,
    deadline,
    rows,
    sources: sourceRows(others, 'filing', t, page).map((row, index) =>
      // A party seat's own source row is the section's first.
      partySeat?.source == null
        ? row
        : { ...row, testID: `${OFFICE_TEST_IDS.sourceLink}-filing-${String(index + 2)}` },
    ),
    steps:
      election === null
        ? null
        : {
            label: t('office:filing.steps'),
            onPress: page.openSteps,
            testID: OFFICE_TEST_IDS.stepsOpen,
          },
  };
}

// ---------------------------------------------------------------------------------------------------
// The tracks sheet

export type TrackProps = { key: string; name: string; rows: Fact[]; source: SourceLinkProps };

export type TracksProps = { tracks: TrackProps[]; none: string | null; caution: string };

function trackName(track: FilingTrack, election: ElectionView, t: TFunction): string {
  switch (track.track) {
    case 'party_primary':
      // A primary with no party is a top-two or a nonpartisan one.
      return election.party === null
        ? t('office:track.nonpartisan')
        : t('office:track.partyPrimary', { party: partyLabel(election.party, t) });
    case 'nonpartisan':
      return t('office:track.nonpartisan');
    case 'independent':
      return t('office:track.independent');
    case 'write_in':
      return t('office:track.writeIn');
    case 'incumbent':
      return t('office:track.incumbent');
    default:
      return assertNever(track.track);
  }
}

function trackRows(track: FilingTrack, t: TFunction, ctx: CardContext): Fact[] {
  const zone = track.timezone;
  const proof = track.fieldMeta;
  const day = (date: string | null): DisplayValue =>
    words(date === null ? null : t('office:track.day', { date: deadlineDate(date, zone, ctx) }));
  let closes = day(track.closesOn);
  // The closing hour only where a source states one, in the zone it was stated in.
  if (track.closesOn !== null && track.closesTime !== null) {
    closes = words(
      t('office:track.closesAt', {
        date: deadlineDate(track.closesOn, zone, ctx),
        time: formatLocalTime(track.closesTime, zone, t),
      }),
    );
  }
  return [
    { key: 'opensOn', label: t('office:trackField.opensOn'), value: day(track.opensOn) },
    { key: 'closesOn', label: t('office:trackField.closesOn'), value: closes },
    {
      key: 'petitionOpens',
      label: t('office:trackField.petitionOpens'),
      value: day(track.petitionOpens),
    },
    {
      key: 'petitionDue',
      label: t('office:trackField.petitionDue'),
      value: day(track.petitionDue),
    },
    {
      key: 'feeCents',
      label: t('office:trackField.feeCents'),
      value: toDisplayValue({ value: track.feeCents, meta: proof.feeCents ?? null }, (cents) =>
        cents === 0 ? t('office:filing.noFee') : formatMoney(cents, ctx.locale),
      ),
    },
    {
      key: 'signatures',
      label: t('office:trackField.signatures'),
      value: toDisplayValue({ value: track.signatures, meta: proof.signatures ?? null }, (count) =>
        formatNumber(count, ctx.locale),
      ),
    },
    {
      key: 'whereToFile',
      label: t('office:trackField.whereToFile'),
      value: words(track.whereToFile),
    },
  ];
}

/** The filing steps of the next election: each track with its dates, its facts and its source. */
export function presentTracks(
  election: ElectionView | null,
  t: TFunction,
  ctx: CardContext,
  page: Pick<OfficePageActions, 'openSources'>,
): TracksProps {
  const tracks = (election?.tracks ?? []).map((track, index): TrackProps => {
    // `election` is not null where it has a track.
    const name = election === null ? '' : trackName(track, election, t);
    const domain = sourceDomain(track.sourceUrl);
    const line = sourceLine(
      {
        sourceUrl: track.sourceUrl,
        quote: track.quote,
        confidence: track.confidence,
        checkedAt: track.checkedAt,
        // Names the statute where the date is computed from one and no page states it.
        ruleCitation: track.ruleCitation,
      },
      t,
      ctx,
    );
    const entry: SourceEntry = {
      id: track.id,
      covers: name,
      line,
      confidence: track.confidence,
      quote: track.quote,
      url: domain === null ? null : track.sourceUrl,
      domain,
    };
    return {
      key: track.id,
      name,
      rows: trackRows(track, t, ctx),
      source: {
        confidence: track.confidence,
        text: line,
        onPress: () => {
          page.openSources(name, [entry]);
        },
        testID: `${OFFICE_TEST_IDS.sourceLink}-track-${String(index + 1)}`,
      },
    };
  });
  return {
    tracks,
    none: tracks.length === 0 ? t('office:filing.noTracks') : null,
    caution: t('common:confirmBeforeFiling'),
  };
}

// ---------------------------------------------------------------------------------------------------
// Blocks 14 and 15: the sources, and who is running

/** Every source of the page, one entry per distinct source. */
export function presentPageSources(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
): SourceEntry[] {
  return entriesFor(pageFieldMeta(office), PAGE_FIELDS, t, ctx);
}

export type RunningProps = {
  /** The number of people who filed, for the section's head. */
  count: string;
  rows: PersonRowProps[];
  showAll: { label: string; onPress: () => void; testID: string } | null;
  none: string | null;
};

export function presentRunning(
  candidates: OfficeReadyData['candidates'],
  t: TFunction,
  ctx: CardContext,
): RunningProps {
  const count = formatNumber(candidates.total, ctx.locale);
  const { onShowAll } = candidates;
  return {
    count,
    rows: candidates.entries.map(({ candidacy, entry }) =>
      presentPersonRow(
        {
          kind: 'candidate',
          entry,
          candidacy,
          testID: `${OFFICE_TEST_IDS.candidate}-${candidacy.id}`,
        },
        t,
        ctx,
      ),
    ),
    showAll:
      onShowAll === null
        ? null
        : {
            label: t('office:running.showAll', { count }),
            onPress: onShowAll,
            testID: OFFICE_TEST_IDS.runningShowAll,
          },
    none: candidates.entries.length === 0 ? t('office:running.none') : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// The actions, the action card and an error's sentence

/** The action row of the office, the same in the sticky bar and in the action card. */
export function presentActions(
  office: OfficeDetail,
  actions: OfficeReadyData['actions'],
  t: TFunction,
): Omit<ActionRowProps, 'layout'> {
  return {
    kind: 'office',
    run: presentRunSlot(actions, t),
    following: actions.following,
    bookmarked: actions.bookmarked,
    onRun: actions.onRun,
    onToggleFollow: actions.onToggleFollow,
    onToggleBookmark: actions.onToggleBookmark,
    itemKey: `office:${office.id}`,
    partTestIDs: {
      run: OFFICE_TEST_IDS.runButton,
      follow: OFFICE_TEST_IDS.followButton,
      bookmark: OFFICE_TEST_IDS.bookmarkButton,
    },
    testID: OFFICE_TEST_IDS.actions,
  };
}

/**
 * The sentence of an error code. A failure with no code, and the one code whose sentence holds a
 * date this page does not have, read the generic sentence.
 */
export function errorSentence(code: ErrorCode | null, t: TFunction): string {
  return code === null || code === 'handle_change_too_soon'
    ? t('errors:generic')
    : t(`errors:${code}`);
}

type CardMeter = Omit<MeterProps, 'form' | 'onPress'>;

export type ActionCardProps = {
  /** Set while filing is open: the days left as a numeral, and the sentence that says them. */
  days: { figure: string; label: string } | null;
  /** The closing line; it always names the date its day count is counted to. */
  closingLine: string;
  ease: CardMeter;
  impact: CardMeter;
};

/** Where filing stands for the card: the day count while it is open, and the closing line. */
function closingOf(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
): Pick<ActionCardProps, 'days' | 'closingLine'> {
  const election = office.nextElectionDetail;
  if (election === null || office.filingStatus === 'no_election') {
    return {
      days: null,
      closingLine: closingLineText({ state: 'none', date: null, time: null }, t),
    };
  }
  const { window } = deadlineInputOfElection(election, office);
  let state: ClosingInput['state'];
  let daysLeft: number | null = null;
  if (window.closesOn === null) {
    state = 'unknown';
  } else if (office.filingStatus === 'closed') {
    state = 'closed';
  } else {
    const stands = filingWindowState(window, ctx.now);
    state = stands.state;
    daysLeft = stands.state === 'open' ? stands.daysLeft : null;
  }
  // A window that is not open yet names the day it opens.
  const date = state === 'not_open' ? window.opensOn : window.closesOn;
  const closingLine = closingLineText(
    {
      state,
      date: date === null ? null : deadlineDate(date, window.zone, ctx),
      time: window.closesTime === null ? null : formatLocalTime(window.closesTime, window.zone, t),
    },
    t,
  );
  return {
    days:
      daysLeft === null
        ? null
        : {
            figure: formatNumber(daysLeft, ctx.locale),
            label: t('office:actionCard.daysLeft', { count: daysLeft }),
          },
    closingLine,
  };
}

/** The action card's day count, closing line and meters. The scores are not known yet. */
export function presentActionCard(
  office: OfficeDetail,
  t: TFunction,
  ctx: CardContext,
): ActionCardProps {
  return {
    ...closingOf(office, t, ctx),
    ease: {
      name: t('office:meter.easeName'),
      score: office.ease,
      phrase: null,
      itemKey: `office:${office.id}:ease`,
      testID: OFFICE_TEST_IDS.actionCardEase,
    },
    impact: {
      name: t('office:meter.impactName'),
      score: office.impact,
      phrase: null,
      itemKey: `office:${office.id}:impact`,
      testID: OFFICE_TEST_IDS.actionCardImpact,
    },
  };
}
