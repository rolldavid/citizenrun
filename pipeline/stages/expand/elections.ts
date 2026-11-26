// The elections of every office with a schedule (PIPE-expand step 8): this stage's offices and the
// legislative and congressional offices of stage 2, each contest of the window an election row
// with its turnout class and the proof of its date.
import { BElectionSchema } from '@citizenrun/shared';
import type { BElection } from '@citizenrun/shared';
import type { StateRules } from '@citizenrun/rules';
import { resolve } from '../../lib/confidence.ts';
import { contestsInWindow } from '../shared/contests.ts';
import type { WindowContest } from '../shared/contests.ts';
import { computedEvidence } from '../shared/evidence.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import { turnoutClasses, turnoutKey } from './turnout.ts';
import type { DatedContest } from './turnout.ts';

export type ElectionRef = { readonly ref: OfficeRefRow; readonly statewide: boolean };

/**
 * The election rows of `refs`, and each office's contests by slug for its seats up next. With no
 * rules module there are none.
 */
export function buildElections(input: {
  readonly refs: readonly ElectionRef[];
  readonly rules: StateRules | null;
  readonly state: string;
  readonly today: string;
  readonly now: Date;
  readonly newestRetrievedOn: string | null;
}): {
  readonly elections: readonly BElection[];
  readonly contestsBySlug: ReadonlyMap<string, readonly WindowContest[]>;
} {
  const contestsBySlug = new Map<string, readonly WindowContest[]>();
  const rules = input.rules;
  if (rules === null) {
    return { elections: [], contestsBySlug };
  }
  const dated: DatedContest[] = [];
  const pending: { ref: OfficeRefRow; contest: WindowContest }[] = [];
  for (const { ref, statewide } of input.refs) {
    const contests = contestsInWindow(ref, input.state, rules, input.today);
    contestsBySlug.set(ref.slug, contests);
    for (const contest of contests) {
      dated.push({
        state: input.state,
        date: contest.date,
        kind: contest.kind,
        party: contest.party,
        officeTypeId: ref.office_type_id,
        statewide,
      });
      pending.push({ ref, contest });
    }
  }
  const classes = turnoutClasses(dated);
  const elections: BElection[] = [];
  const seen = new Set<string>();
  for (const { ref, contest } of pending) {
    const sourceKey = `${ref.slug}|${turnoutKey(contest)}`;
    if (seen.has(sourceKey)) {
      continue;
    }
    seen.add(sourceKey);
    const evidence = computedEvidence(
      contest.date,
      contest.dateCitation,
      input.newestRetrievedOn,
      input.now,
    );
    const { meta } = resolve('election_date', [evidence], input.now);
    elections.push(
      BElectionSchema.parse({
        source_key: sourceKey,
        office_key: ref.slug,
        election_date: contest.date,
        kind: contest.kind,
        party: contest.party,
        turnout_class: classes.get(turnoutKey(contest)),
        deadline_conflict: null,
        field_meta: meta === null ? {} : { election_date: meta },
      }),
    );
  }
  return { elections, contestsBySlug };
}
