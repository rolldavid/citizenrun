import {
  effectiveHourlyCents,
  fieldMetaEntries,
  termPayCents,
  toFieldMeta,
} from '@citizenrun/shared';
import type {
  CandidacyView,
  Confidence,
  ElectionView,
  OfficeDetail,
  OfficeSummary,
  ResultView,
} from '@citizenrun/shared';

// The pure half of E-OFF-01: the page's own keys from the rows its reads returned. Every stored
// snake_case shape becomes camelCase here; a value not known stays null.

/** One stored `offices.eligibility` requirement. */
export type StoredEligibility = {
  kind: NonNullable<OfficeDetail['eligibility']>[number]['kind'];
  value: string;
  quote?: string | null;
  source_url?: string | null;
  confidence: Confidence;
};

/** One stored `offices.ease_inputs` term. */
export type StoredEaseInput = {
  key: NonNullable<OfficeDetail['easeInputs']>[number]['key'];
  value: number | null;
  known: boolean;
  source_url?: string | null;
  checked_at?: string | null;
  contribution: number;
  note?: string | null;
};

/** The stored `offices.effort`; `dollars` holds integer cents. */
export type StoredEffort = {
  hours: number;
  dollars: number;
  assumptions: Array<{ key: string; value: number | null; unit: string }>;
};

/** The detail columns of one office with its type, jurisdiction and district (E-OFF-01 read a). */
export type OfficeDetailRow = {
  officeTypeName: string;
  termYears: number | null;
  termLimitTerms: number | null;
  electorate: number | null;
  benefits: OfficeDetail['benefits'];
  meetingTimes: OfficeDetail['meetingTimes'];
  payChangeNote: string | null;
  whereToFile: string | null;
  partySelection: OfficeDetail['partySelection'];
  eligibility: StoredEligibility[] | null;
  entrenched: boolean | null;
  decidedIn: OfficeDetail['decidedIn'];
  effort: StoredEffort | null;
  easeInputs: StoredEaseInput[] | null;
  changedAt: string;
  fieldMeta: unknown;
  budgetCents: number | null;
  budgetYear: number | null;
  jurisdictionFieldMeta: unknown;
  lean: number | null;
  leanBasis: OfficeDetail['lean']['basis'];
};

/** Everything buildOfficeDetail reads. */
export type OfficeDetailInput = {
  summary: OfficeSummary;
  row: OfficeDetailRow;
  powers: OfficeDetail['powers'];
  issueRelevance: OfficeDetail['issueRelevance'];
  nextElectionDetail: ElectionView | null;
  upcomingElections: ElectionView[];
  results: ResultView[];
  officeholders: OfficeDetail['officeholders'];
  /** `people.party` of every current officeholder, for the party split. */
  holderParties: ReadonlyArray<string | null>;
  candidates: CandidacyView[];
  candidatesCount: number;
};

// Code-unit order, so the split never depends on the runtime's locale.
function compareParty(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a < b ? -1 : 1;
}

/** Current holders by party, most seats first, then party name with the unknown party last. */
function partySplitOf(
  parties: ReadonlyArray<string | null>,
): Array<{ party: string | null; count: number }> {
  const counts = new Map<string | null, number>();
  for (const party of parties) {
    counts.set(party, (counts.get(party) ?? 0) + 1);
  }
  return [...counts]
    .map(([party, count]) => ({ party, count }))
    .sort((a, b) => b.count - a.count || compareParty(a.party, b.party));
}

/** Board control: null for a single-person office. */
function boardControlOf(
  summary: OfficeSummary,
  parties: ReadonlyArray<string | null>,
): OfficeDetail['boardControl'] {
  const { seats, bodySize, seatsUpNext, partisan } = summary;
  if (seats === 1 && (bodySize === null || bodySize === 1)) {
    return null;
  }
  return {
    seats,
    bodySize,
    seatsUpNext,
    majority: bodySize === null ? null : Math.floor(bodySize / 2) + 1,
    partySplit: partisan === true ? partySplitOf(parties) : null,
  };
}

function votesBasisOf(summary: OfficeSummary): OfficeDetail['votesBasis'] {
  if (summary.votesToWin === null) {
    return null;
  }
  return summary.votesEstimated === true ? 'estimate' : 'results';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The office page of one office (E-OFF-01). `onInvalidProof` hears each stored proof that does not parse. */
export function buildOfficeDetail(
  input: OfficeDetailInput,
  onInvalidProof: (column: string) => void = () => undefined,
): OfficeDetail {
  const { summary, row } = input;
  const { entries, invalid } = fieldMetaEntries(row.fieldMeta, [
    ['payAnnualCents', 'pay_annual_cents', summary.payAnnualCents],
    ['payKind', 'pay_kind', summary.payKind],
    ['payAmountCents', 'pay_amount_cents', summary.payAmountCents],
    ['payPeriod', 'pay_period', summary.payPeriod],
    ['benefits', 'benefits', row.benefits],
    ['hoursPerWeek', 'hours_per_week', summary.hoursPerWeek],
    ['fullTime', 'full_time', summary.fullTime],
    ['meetingTimes', 'meeting_times', row.meetingTimes],
    ['payChangeNote', 'pay_change_note', row.payChangeNote],
    ['filingFeeCents', 'filing_fee_cents', summary.filingFeeCents],
    ['signaturesRequired', 'signatures_required', summary.signaturesRequired],
    ['whereToFile', 'where_to_file', row.whereToFile],
    ['seats', 'seats', summary.seats],
    ['bodySize', 'body_size', summary.bodySize],
    ['seatsUpNext', 'seats_up_next', summary.seatsUpNext],
    ['termYears', 'term_years', row.termYears],
    ['termLimitTerms', 'term_limit_terms', row.termLimitTerms],
    ['partisan', 'partisan', summary.partisan],
    ['partySelection', 'party_selection', row.partySelection],
    ['electorateCount', 'electorate', row.electorate],
  ]);
  invalid.forEach(onInvalidProof);
  const fieldMeta: OfficeDetail['fieldMeta'] = { ...entries };
  // The headline track's proof (PB-42); fitsDayJob is derived and has no entry.
  if (summary.fieldMeta.filingDeadline !== undefined) {
    fieldMeta.filingDeadline = summary.fieldMeta.filingDeadline;
  }

  let budgetMeta = null;
  if (row.budgetCents !== null && isRecord(row.jurisdictionFieldMeta)) {
    const stored = row.jurisdictionFieldMeta['budget_cents'];
    if (stored !== undefined && stored !== null) {
      budgetMeta = toFieldMeta(stored);
      if (budgetMeta === null) {
        onInvalidProof('budget_cents');
      }
    }
  }

  return {
    ...summary,
    officeTypeName: row.officeTypeName,
    termYears: row.termYears,
    termLimitTerms: row.termLimitTerms,
    electorateCount: row.electorate,
    benefits: row.benefits,
    meetingTimes: row.meetingTimes,
    payChangeNote: row.payChangeNote,
    termPayCents: termPayCents(summary.payAnnualCents, row.termYears),
    effectiveHourlyCents: effectiveHourlyCents(summary.payAnnualCents, summary.hoursPerWeek),
    whereToFile: row.whereToFile,
    partySelection: row.partySelection,
    eligibility:
      row.eligibility === null
        ? null
        : row.eligibility.map((item) => ({
            kind: item.kind,
            value: item.value,
            quote: item.quote ?? null,
            sourceUrl: item.source_url ?? null,
            confidence: item.confidence,
          })),
    budget: { cents: row.budgetCents, year: row.budgetYear, meta: budgetMeta },
    powers: input.powers,
    issueRelevance: input.issueRelevance,
    // Impact keys are filled once offices are scored; until then these are their empty forms.
    headlineIssue: null,
    impactInputs: {
      issues: [],
      scale: null,
      pivot: null,
      termFactor: null,
      population: null,
      populationSource: null,
      label: null,
    },
    easeInputs:
      row.easeInputs === null
        ? null
        : row.easeInputs.map((item) => ({
            key: item.key,
            value: item.value,
            known: item.known,
            sourceUrl: item.source_url ?? null,
            checkedAt: item.checked_at ?? null,
            contribution: item.contribution,
            note: item.note ?? null,
          })),
    entrenched: row.entrenched,
    decidedIn: row.decidedIn,
    // With no basis there is no lean to qualify (D-323).
    lean: {
      points: row.lean,
      basis: row.leanBasis,
      approximate: row.leanBasis !== null && row.leanBasis !== 'precinct',
    },
    votesBasis: votesBasisOf(summary),
    // `dollars` holds integer cents, sent unchanged (PB-05).
    effort:
      row.effort === null
        ? null
        : {
            hours: row.effort.hours,
            costCents: row.effort.dollars,
            assumptions: row.effort.assumptions.map((item) => ({
              key: item.key,
              value: item.value,
              unit: item.unit,
            })),
          },
    nextElectionDetail: input.nextElectionDetail,
    upcomingElections: input.upcomingElections,
    results: input.results,
    officeholders: input.officeholders,
    boardControl: boardControlOf(summary, input.holderParties),
    candidates: input.candidates,
    candidatesCount: input.candidatesCount,
    // No declaration exists yet, so no one is a declared runner.
    declaredRunners: [],
    declaredRunnersCount: 0,
    changedAt: row.changedAt,
    fieldMeta,
  };
}
