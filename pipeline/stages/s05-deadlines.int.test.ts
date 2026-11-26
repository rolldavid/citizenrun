import type { StateRules } from '@citizenrun/rules';
import { BFilingTrackSchema } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  COMMISSION,
  COUNCIL_1,
  SENATE_2,
  ZZ_ELECTIONS,
  ZZ_KNOWN_ELECTIONS,
  ZZ_KNOWN_REFS,
  ZZ_NOW,
  ZZ_S04_REFS,
} from '../__fixtures__/s05/zz-elections.ts';
import { ZZ_RULES_IMPLAUSIBLE } from '../__fixtures__/s05/zz-rules-implausible.ts';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import { FactSchema } from '../lib/facts.ts';
import {
  NO_FETCHER,
  StageFailedSchema,
  readStageMeta,
  readStageRows,
  runStage,
} from '../lib/runner.ts';
import type { RunContext, StageId, StageModule } from '../lib/runner.ts';
import { fixtureContext } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import { ZZ_RULES } from '../templates/__fixtures__/zz-rules.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { CertificationRowSchema } from './deadlines/certification.ts';
import { S05_FILES, makeS05Deadlines } from './s05-deadlines.ts';

beforeEach(async () => {
  await resetStorage();
});

function context(bucket: DataBucket): RunContext {
  return fixtureContext({ bucket, fetcher: NO_FETCHER, now: ZZ_NOW, runId: testRunId() });
}

/** Writes rows as a complete output of `stage` for ZZ, through the runner. */
async function writeStageOutput(
  ctx: RunContext,
  stage: StageId,
  files: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>,
): Promise<void> {
  const module: StageModule = {
    id: stage,
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve(['ZZ']),
    async run(_ctx, _state, opts) {
      const written = [];
      for (const [name, rows] of Object.entries(files)) {
        written.push(await opts.out.writeRows(name, rows));
      }
      return { files: written, checks: [], datasets: {} };
    },
  };
  const result = await runStage(module, ctx, ['ZZ'], { dryRun: false });
  expect(result.exitCode).toBe(0);
}

async function seed(bucket: DataBucket): Promise<void> {
  const ctx = context(bucket);
  await writeStageOutput(ctx, 's04-expand', {
    elections: [...ZZ_ELECTIONS, ...ZZ_KNOWN_ELECTIONS],
    office_refs: ZZ_S04_REFS,
  });
  await writeStageOutput(ctx, 's02-known', { office_refs: ZZ_KNOWN_REFS });
}

async function rows<T>(bucket: DataBucket, name: string, schema: z.ZodType<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of readStageRows(bucket, 's05-deadlines', 'ZZ', name, schema)) {
    out.push(row);
  }
  return out;
}

function rulesOf(rules: StateRules): (state: string) => StateRules | null {
  return (state) => (state === 'ZZ' ? rules : null);
}

describe('stage 5', () => {
  it('writes the filing tracks, facts and certification dates', async () => {
    const { bucket } = await getTestBucket('data');
    await seed(bucket);
    const ctx = context(bucket);
    const stage = makeS05Deadlines({ rulesFor: rulesOf(ZZ_RULES) });
    expect(await stage.states(ctx)).toEqual(['ZZ']);
    const result = await runStage(stage, ctx, 'all', { dryRun: false });
    expect(result.exitCode).toBe(0);

    const meta = await readStageMeta(bucket, 's05-deadlines', 'ZZ');
    expect(meta?.files.map((f) => [f.name, f.rows])).toEqual([
      [S05_FILES.filingTracks, 20],
      [S05_FILES.facts, 11],
      [S05_FILES.certification, 20],
    ]);
    expect(meta?.checks).toEqual([
      { name: 'rules_plausible', passed: true, detail: 'rule_implausible=0' },
      {
        name: 'deadlines',
        passed: true,
        detail:
          'elections=20 tracks=20 rule_implausible=0 ref_missing=0 ref_unscheduled=0 facts=11',
      },
    ]);
    const tracks = await rows(bucket, S05_FILES.filingTracks, BFilingTrackSchema);
    // Stage 2's senate office gets its tracks from its own ref.
    expect(
      tracks.filter((t) => t.election_key.startsWith(`${SENATE_2}|`)).map((t) => t.source_key),
    ).toEqual([
      `${SENATE_2}|2028-05-02|primary|democratic|party_primary`,
      `${SENATE_2}|2028-05-02|primary|republican|party_primary`,
      `${SENATE_2}|2028-11-07|general||independent`,
    ]);
    const facts = await rows(bucket, S05_FILES.facts, FactSchema);
    expect(facts.filter((f) => f.key === COMMISSION).map((f) => [f.field, f.value])).toEqual([
      ['filing_fee_cents', 45_000],
      ['signatures_required', 0],
      ['where_to_file', 'Fixture County Board of Elections'],
    ]);
    // The senate office has no pay, so its percent fee is not known and no fee fact is written.
    expect(facts.filter((f) => f.key === SENATE_2).map((f) => f.field)).toEqual([
      'signatures_required',
      'where_to_file',
    ]);
    const certification = await rows(bucket, S05_FILES.certification, CertificationRowSchema);
    expect(
      certification.find((c) => c.election_key === `${COUNCIL_1}|2027-11-02|general|`)?.date,
    ).toBe('2027-11-12');
  });

  it('a failed rules_plausible keeps the first run output', async () => {
    const { bucket } = await getTestBucket('data');
    await seed(bucket);
    const first = context(bucket);
    await runStage(makeS05Deadlines({ rulesFor: rulesOf(ZZ_RULES) }), first, ['ZZ'], {
      dryRun: false,
    });
    const before = await readStageMeta(bucket, 's05-deadlines', 'ZZ');
    const tracksBefore = await rows(bucket, S05_FILES.filingTracks, BFilingTrackSchema);

    const second = context(bucket);
    const result = await runStage(
      makeS05Deadlines({ rulesFor: rulesOf(ZZ_RULES_IMPLAUSIBLE) }),
      second,
      ['ZZ'],
      { dryRun: false },
    );
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.failedChecks).toEqual(['rules_plausible']);
    const failed = await bucket.getJson(
      bucketKeys.stageFailed('s05-deadlines', 'ZZ', second.runId),
      StageFailedSchema,
    );
    expect(failed?.error).toBeNull();
    expect(failed?.checks.find((c) => c.name === 'rules_plausible')).toMatchObject({
      passed: false,
      detail: expect.stringMatching(/^rule_implausible=3 keys=/) as unknown,
    });
    expect(await readStageMeta(bucket, 's05-deadlines', 'ZZ')).toEqual(before);
    expect(before?.run_id).toBe(first.runId);
    expect(await rows(bucket, S05_FILES.filingTracks, BFilingTrackSchema)).toEqual(tracksBefore);
  });

  it('a state with no module writes empty files', async () => {
    const { bucket } = await getTestBucket('data');
    await seed(bucket);
    const ctx = context(bucket);
    const result = await runStage(makeS05Deadlines({ rulesFor: () => null }), ctx, ['ZZ'], {
      dryRun: false,
    });
    expect(result.exitCode).toBe(0);
    const meta = await readStageMeta(bucket, 's05-deadlines', 'ZZ');
    expect(meta?.files.map((f) => f.rows)).toEqual([0, 0, 0]);
    expect(meta?.checks[0]).toEqual({
      name: 'rules_plausible',
      passed: true,
      detail: 'no rules module',
    });
  });

  it('a state without stage 4 output fails with no files', async () => {
    const { bucket } = await getTestBucket('data');
    const ctx = context(bucket);
    const stage = makeS05Deadlines({ rulesFor: rulesOf(ZZ_RULES) });
    expect(await stage.states(ctx)).toEqual([]);
    const result = await runStage(stage, ctx, ['ZZ'], { dryRun: false });
    expect(result.summaries[0]?.errorClass).toBe('DeadlinesInputMissing');
    expect(await readStageMeta(bucket, 's05-deadlines', 'ZZ')).toBeNull();
  });
});
