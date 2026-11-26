// Stage 5 (PIPE-deadlines): the filing tracks, office headline facts and certification dates of
// every election stage 4 made, from the state's rules module.
import { BElectionSchema } from '@citizenrun/shared';
import { rulesFor } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';
import type { StageModule, StageResult } from '../lib/runner.ts';
import { CERTIFICATION_FILE } from './deadlines/certification.ts';
import { RULES_PLAUSIBLE, deadlinesState } from './deadlines/deadlines-state.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from './shared/office-ref.ts';
import { repoRoot } from './shared/repo.ts';
import { rulesFixtureInfo } from './shared/rules-fixtures.ts';
import { listStageStates, loadStageRows } from './shared/stage-io.ts';

export type S05Deps = {
  readonly rulesFor: (state: string) => StateRules | null;
};

/** The files this stage writes, by their `writeRows` names. */
export const S05_FILES = Object.freeze({
  filingTracks: 'filing_tracks',
  facts: 'facts',
  certification: CERTIFICATION_FILE,
});

/** Stage 4's elections file. */
const ELECTIONS_FILE = 'elections';

/** A state with no complete stage 4 output, or one that lists no elections file. */
export class DeadlinesInputMissing extends Error {
  override readonly name = 'DeadlinesInputMissing';

  constructor(state: string) {
    super(`the state ${state} has no complete s04-expand elections output`);
  }
}

/** Stage 5 with the rules modules `deps.rulesFor` gives. */
export function makeS05Deadlines(deps: S05Deps): StageModule {
  return {
    id: 's05-deadlines',
    milestone: 2,
    blockingChecks: [RULES_PLAUSIBLE],
    async states(ctx) {
      return (await listStageStates(ctx, 's04-expand')).filter((state) => state !== 'US');
    },
    async run(ctx, state, opts): Promise<StageResult> {
      const elections = await loadStageRows(
        ctx,
        's04-expand',
        state,
        ELECTIONS_FILE,
        BElectionSchema,
      );
      if (elections === null) {
        throw new DeadlinesInputMissing(state);
      }
      const expandRefs =
        (await loadStageRows(ctx, 's04-expand', state, OFFICE_REFS_FILE, OfficeRefRowSchema)) ?? [];
      const knownRefs =
        (await loadStageRows(ctx, 's02-known', state, OFFICE_REFS_FILE, OfficeRefRowSchema)) ?? [];
      const { newestRetrievedOn } = await rulesFixtureInfo(repoRoot(), state);
      const output = deadlinesState({
        state,
        today: ctx.today,
        now: ctx.now,
        elections,
        refs: [...expandRefs, ...knownRefs],
        rules: deps.rulesFor(state),
        newestRetrievedOn,
      });
      const files = [
        await opts.out.writeRows(S05_FILES.filingTracks, output.tracks),
        await opts.out.writeRows(S05_FILES.facts, output.facts),
        await opts.out.writeRows(S05_FILES.certification, output.certification),
      ];
      return { files, checks: output.checks, datasets: {} };
    },
  };
}

/** Stage 5 with the registered rules modules. */
export const s05Deadlines: StageModule = makeS05Deadlines({ rulesFor });
