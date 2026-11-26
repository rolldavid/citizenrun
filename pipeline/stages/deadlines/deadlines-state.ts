// The pure core of stage 5 (PIPE-deadlines): filing tracks, office headline facts and certification
// dates for one state. Reads no clock, environment, network or bucket.
import type { OfficeRef, StateRules } from '@citizenrun/rules';
import type { BElection, BFilingTrack } from '@citizenrun/shared';
import type { Fact } from '../../lib/facts.ts';
import { OfficeRefUnscheduled, toRulesOfficeRef } from '../shared/office-ref.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import { certificationRow } from './certification.ts';
import type { CertificationRow } from './certification.ts';
import { headlineFacts } from './headline.ts';
import { tracksFor } from './tracks.ts';

export type DeadlinesInput = {
  readonly state: string;
  readonly today: string;
  readonly now: Date;
  readonly elections: readonly BElection[];
  /** Stage 4's refs, then stage 2's; the first ref of a slug is used. */
  readonly refs: readonly OfficeRefRow[];
  readonly rules: StateRules | null;
  readonly newestRetrievedOn: string | null;
};

export type DeadlinesCheck = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type DeadlinesOutput = {
  readonly tracks: readonly BFilingTrack[];
  readonly facts: readonly Fact[];
  readonly certification: readonly CertificationRow[];
  readonly checks: readonly DeadlinesCheck[];
  readonly counts: Readonly<Record<string, number>>;
};

/** The blocking check: no track of the state's rules module is implausible. */
export const RULES_PLAUSIBLE = 'rules_plausible';
/** How many dropped track keys the failed check names. */
const DETAIL_KEYS = 5;
const DETAIL_MAX = 2000;

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function countsDetail(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .map(([name, n]) => `${name}=${String(n)}`)
    .join(' ');
}

/**
 * Stage 5 over one state's elections and office refs. With no rules module the elections keep no
 * tracks and `rules_plausible` passes; otherwise every implausible track is dropped and the check
 * fails, naming the first five dropped track keys.
 */
export function deadlinesState(input: DeadlinesInput): DeadlinesOutput {
  const counts = {
    elections: input.elections.length,
    tracks: 0,
    rule_implausible: 0,
    ref_missing: 0,
    ref_unscheduled: 0,
    facts: 0,
  };
  const rules = input.rules;
  if (rules === null) {
    return {
      tracks: [],
      facts: [],
      certification: [],
      checks: [
        { name: RULES_PLAUSIBLE, passed: true, detail: 'no rules module' },
        { name: 'deadlines', passed: true, detail: countsDetail(counts) },
      ],
      counts,
    };
  }
  const refs = new Map<string, OfficeRefRow>();
  for (const ref of input.refs) {
    if (!refs.has(ref.slug)) {
      refs.set(ref.slug, ref);
    }
  }
  const tracks: BFilingTrack[] = [];
  const dropped: string[] = [];
  const certification: CertificationRow[] = [];
  for (const election of input.elections) {
    const ref = refs.get(election.office_key);
    if (ref === undefined) {
      counts.ref_missing += 1;
      continue;
    }
    let office: OfficeRef;
    try {
      office = toRulesOfficeRef(ref, input.state);
    } catch (error) {
      if (error instanceof OfficeRefUnscheduled) {
        counts.ref_unscheduled += 1;
        continue;
      }
      throw error;
    }
    const result = tracksFor({
      election,
      ref,
      state: input.state,
      rules,
      now: input.now,
      newestRetrievedOn: input.newestRetrievedOn,
    });
    tracks.push(...result.kept);
    dropped.push(...result.implausible.map((item) => item.sourceKey));
    const certified = rules.certificationDate({
      office,
      contest: { date: election.election_date, kind: election.kind, party: election.party },
    });
    if (certified !== null) {
      certification.push(certificationRow(election, certified));
    }
  }
  tracks.sort((a, b) => byteOrder(a.source_key, b.source_key));
  certification.sort((a, b) => byteOrder(a.election_key, b.election_key));
  dropped.sort(byteOrder);
  const facts = headlineFacts([...refs.values()], input.elections, tracks, input.today);
  counts.tracks = tracks.length;
  counts.rule_implausible = dropped.length;
  counts.facts = facts.length;
  const plausible: DeadlinesCheck =
    dropped.length === 0
      ? { name: RULES_PLAUSIBLE, passed: true, detail: 'rule_implausible=0' }
      : {
          name: RULES_PLAUSIBLE,
          passed: false,
          detail: `rule_implausible=${String(dropped.length)} keys=${dropped
            .slice(0, DETAIL_KEYS)
            .join(',')}`.slice(0, DETAIL_MAX),
        };
  return {
    tracks,
    facts,
    certification,
    checks: [plausible, { name: 'deadlines', passed: true, detail: countsDetail(counts) }],
    counts,
  };
}
