// The filing tracks of one election (PIPE-deadlines steps 1 and 2): each track the rules module
// returns, with its fee and signatures evaluated, its proof from the closing date's citation and a
// `field_meta` entry for every other column whose citation differs.
import { evaluateFee, evaluateSignatures } from '@citizenrun/rules';
import type { Citation, StateRules } from '@citizenrun/rules';
import { BFilingTrackSchema } from '@citizenrun/shared';
import type { BElection, BFilingTrack, FieldMetaRow } from '@citizenrun/shared';
import { resolve } from '../../lib/confidence.ts';
import { checkTrackDates } from '../../lib/plausibility.ts';
import { computedEvidence } from '../shared/evidence.ts';
import { toRulesOfficeRef } from '../shared/office-ref.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';

export type ImplausibleRule =
  | 'closes_after_election'
  | 'opens_after_closes'
  | 'petition_after_election'
  | 'petition_opens_after_due';

export type TrackInput = {
  readonly election: BElection;
  readonly ref: OfficeRefRow;
  readonly state: string;
  readonly rules: StateRules;
  readonly now: Date;
  readonly newestRetrievedOn: string | null;
};

export type TrackResult = {
  readonly kept: readonly BFilingTrack[];
  readonly implausible: readonly { readonly sourceKey: string; readonly rule: ImplausibleRule }[];
};

/** A rules citation whose source the proof rule refuses (no https URL): a defect in the module. */
export class TrackProofMissing extends Error {
  override readonly name = 'TrackProofMissing';

  constructor(field: string) {
    super(`a computed ${field} has no https source in its citation`);
  }
}

/** The plausibility check names of `checkTrackDates`, as the rules this stage reports. */
const RULE_OF_CHECK: Readonly<Record<string, ImplausibleRule>> = Object.freeze({
  closes_before_election: 'closes_after_election',
  opens_before_closes: 'opens_after_closes',
  petition_due_before_election: 'petition_after_election',
  petition_opens_before_due: 'petition_opens_after_due',
});

/** Columns that take their own `field_meta` entry when their citation differs from the closing date's. */
type MetaColumn =
  | 'opens_on'
  | 'closes_time'
  | 'petition_opens'
  | 'petition_due'
  | 'fee_cents'
  | 'signatures'
  | 'where_to_file';

function sameCitation(a: Citation, b: Citation): boolean {
  return a.citation === b.citation && a.sourceUrl === b.sourceUrl;
}

/** PIPE-confidence over one computed value: its level, check time and proof. */
function computedMeta(
  field: string,
  value: unknown,
  citation: Citation,
  input: Pick<TrackInput, 'now' | 'newestRetrievedOn'>,
): FieldMetaRow {
  const { meta } = resolve(
    field,
    [computedEvidence(value, citation, input.newestRetrievedOn, input.now)],
    input.now,
  );
  if (meta === null) {
    throw new TrackProofMissing(field);
  }
  return meta;
}

/** The B-filing_tracks rows of one election; implausible tracks are dropped and reported. */
export function tracksFor(input: TrackInput): TrackResult {
  const { election, ref, state, rules } = input;
  const office = toRulesOfficeRef(ref, state);
  const outs = rules.filingTracks({
    office,
    contest: { date: election.election_date, kind: election.kind, party: election.party },
  });
  const kept: BFilingTrack[] = [];
  const implausible: { sourceKey: string; rule: ImplausibleRule }[] = [];
  for (const out of outs) {
    const sourceKey = `${election.source_key}|${out.track}`;
    const dates = {
      opens_on: out.opensOn?.value ?? null,
      closes_on: out.closesOn.value,
      petition_opens: out.petitionOpens?.value ?? null,
      petition_due: out.petitionDue?.value ?? null,
    };
    const failure = checkTrackDates(dates, election.election_date);
    if (failure !== null) {
      const rule = RULE_OF_CHECK[failure.check];
      if (rule === undefined) {
        throw new TypeError(`an unknown track date check ${failure.check}`);
      }
      implausible.push({ sourceKey, rule });
      continue;
    }
    // A fee of `none` is a real 0; a percent of unknown pay is null (00 section 4.5).
    const feeCents = out.fee === null ? null : evaluateFee(out.fee.value, office);
    const signatures =
      out.signatures === null ? null : evaluateSignatures(out.signatures.value, { office });
    const closing = out.closesOn.citation;
    const proof = computedMeta('closes_on', out.closesOn.value, closing, input);
    const columns: readonly {
      readonly field: MetaColumn;
      readonly value: string | number | null;
      readonly citation: Citation | null;
    }[] = [
      { field: 'opens_on', value: dates.opens_on, citation: out.opensOn?.citation ?? null },
      {
        field: 'closes_time',
        value: out.closesTime?.value ?? null,
        citation: out.closesTime?.citation ?? null,
      },
      {
        field: 'petition_opens',
        value: dates.petition_opens,
        citation: out.petitionOpens?.citation ?? null,
      },
      {
        field: 'petition_due',
        value: dates.petition_due,
        citation: out.petitionDue?.citation ?? null,
      },
      { field: 'fee_cents', value: feeCents, citation: out.fee?.citation ?? null },
      { field: 'signatures', value: signatures, citation: out.signatures?.citation ?? null },
      {
        field: 'where_to_file',
        value: out.whereToFile?.value ?? null,
        citation: out.whereToFile?.citation ?? null,
      },
    ];
    const fieldMeta: Record<string, FieldMetaRow> = {};
    for (const column of columns) {
      if (
        column.value === null ||
        column.citation === null ||
        sameCitation(column.citation, closing)
      ) {
        continue;
      }
      fieldMeta[column.field] = computedMeta(column.field, column.value, column.citation, input);
    }
    kept.push(
      BFilingTrackSchema.parse({
        source_key: sourceKey,
        election_key: election.source_key,
        track: out.track,
        opens_on: dates.opens_on,
        closes_on: dates.closes_on,
        // Only when the module's citation states the hour (LR-2); never assumed.
        closes_time: out.closesTime?.value ?? null,
        petition_opens: dates.petition_opens,
        petition_due: dates.petition_due,
        fee_cents: feeCents,
        signatures,
        where_to_file: out.whereToFile?.value ?? null,
        basis: 'computed',
        source_url: closing.sourceUrl,
        quote: closing.quote,
        rule_citation: closing.citation,
        confidence: proof.confidence,
        checked_at: proof.checked_at,
        field_meta: fieldMeta,
      }),
    );
  }
  return { kept, implausible };
}
