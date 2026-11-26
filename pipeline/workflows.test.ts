import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { repoRoot } from './lib/paths.ts';

const StepSchema = z.looseObject({
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const JobSchema = z.looseObject({
  'runs-on': z.unknown(),
  environment: z.unknown(),
  if: z.string(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  'timeout-minutes': z.number(),
  env: z.record(z.string(), z.string()).optional(),
  strategy: z.unknown().optional(),
  services: z.record(z.string(), z.looseObject({ image: z.string() })).optional(),
  permissions: z.unknown().optional(),
  steps: z.array(StepSchema),
});

const WorkflowSchema = z.looseObject({
  name: z.string(),
  on: z.looseObject({
    schedule: z.array(z.strictObject({ cron: z.string() })),
    workflow_dispatch: z.strictObject({
      inputs: z.record(
        z.string(),
        z.looseObject({
          type: z.string(),
          default: z.string(),
          options: z.array(z.string()).optional(),
        }),
      ),
    }),
  }),
  permissions: z.unknown(),
  concurrency: z.unknown(),
  env: z.unknown().optional(),
  jobs: z.record(z.string(), JobSchema),
});

type Workflow = z.infer<typeof WorkflowSchema>;

function text(file: string): string {
  return readFileSync(join(repoRoot(), '.github', 'workflows', file), 'utf8');
}

function workflow(file: string): Workflow {
  return WorkflowSchema.parse(parse(text(file)));
}

const base = workflow('pipeline-base.yml');
const bundle = workflow('pipeline-bundle.yml');
const BOTH: readonly [string, Workflow][] = [
  ['pipeline-base.yml', base],
  ['pipeline-bundle.yml', bundle],
];

const YEARLY = '23 6 20 10 *';
const WEEKLY = '41 5 * * 1';
const MONTHLY = '13 4 1 * *';
const READY = "vars.RAILWAY_STAGING_READY == 'true'";

function job(flow: Workflow, id: string) {
  const found = flow.jobs[id];
  if (found === undefined) {
    throw new Error(`no job ${id}`);
  }
  return found;
}

function trigger(cron: string, command: string): string {
  return `(github.event.schedule == '${cron}' || (github.event_name == 'workflow_dispatch' && inputs.command == '${command}'))`;
}

function runs(flow: Workflow, id: string): string[] {
  return job(flow, id).steps.flatMap((step) => (step.run === undefined ? [] : [step.run.trim()]));
}

describe('pipeline-base.yml', () => {
  it('pipeline-base.yml has the three crons and no push trigger', () => {
    expect(base.on.schedule.map((entry) => entry.cron)).toEqual([YEARLY, WEEKLY, MONTHLY]);
    expect(Object.keys(base.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
  });

  it('a dispatch chooses one command and its states', () => {
    const inputs = base.on.workflow_dispatch.inputs;
    expect(inputs.command).toMatchObject({
      type: 'choice',
      options: ['base', 'known', 'coops', 'people', 'housekeeping'],
      default: 'base',
    });
    expect(inputs.states).toMatchObject({ type: 'string', default: 'all' });
  });

  it('has the seven jobs, each with its trigger and time limit', () => {
    expect(Object.keys(base.jobs)).toEqual([
      'plan',
      'base',
      'base-us',
      'known',
      'people',
      'housekeeping',
      'coops',
    ]);
    const expected: Record<string, [string, string, number]> = {
      plan: [YEARLY, 'base', 15],
      base: [YEARLY, 'base', 360],
      'base-us': [YEARLY, 'base', 120],
      known: [WEEKLY, 'known', 180],
      people: [WEEKLY, 'people', 300],
      housekeeping: [WEEKLY, 'housekeeping', 60],
      coops: [MONTHLY, 'coops', 300],
    };
    for (const [id, [cron, command, minutes]] of Object.entries(expected)) {
      expect(job(base, id).if, id).toContain(trigger(cron, command));
      expect(job(base, id)['timeout-minutes'], id).toBe(minutes);
    }
  });

  it('a job whose needs may be skipped still runs unless the run is cancelled', () => {
    expect(job(base, 'base-us').needs).toEqual(['plan', 'base']);
    expect(job(base, 'people').needs).toBe('known');
    expect(job(base, 'base').needs).toBe('plan');
    for (const id of ['base-us', 'people']) {
      expect(job(base, id).if).toMatch(/^\$\{\{ !cancelled\(\) && /);
    }
  });

  it('the plan job writes the states of the base stage for the matrix', () => {
    const plan = job(base, 'plan');
    expect(plan.outputs).toEqual({ states: '${{ steps.plan.outputs.states }}' });
    expect(runs(base, 'plan')).toEqual([
      'pnpm run pipeline base --state "$STATES" --plan-out "$RUNNER_TEMP/plan.json"\n' +
        'echo "states=$(jq -c .states "$RUNNER_TEMP/plan.json")" >> "$GITHUB_OUTPUT"',
    ]);
  });

  it('the base matrix runs at most 20 at once and does not fail fast', () => {
    expect(job(base, 'base').strategy).toEqual({
      matrix: { state: '${{ fromJSON(needs.plan.outputs.states) }}' },
      'max-parallel': 20,
      'fail-fast': false,
    });
    expect(runs(base, 'base')).toEqual(['pnpm run pipeline base --state "${{ matrix.state }}"']);
  });

  it('the base job has the postgres service and no other job has a service', () => {
    const services = job(base, 'base').services;
    expect(Object.keys(services ?? {})).toEqual(['postgres']);
    expect(services?.postgres?.image).toMatch(/^postgis\/postgis:17-3\.7@sha256:[0-9a-f]{64}$/);
    for (const [id, entry] of Object.entries(base.jobs)) {
      if (id !== 'base') {
        expect(entry.services, id).toBeUndefined();
      }
    }
  });

  it('each job runs its command', () => {
    expect(runs(base, 'base-us')).toEqual(['pnpm run pipeline base --state US']);
    expect(runs(base, 'known')).toEqual(['pnpm run pipeline known --state "$STATES"']);
    expect(runs(base, 'people')).toEqual([
      'pnpm run pipeline people --state "$STATES"',
      'pnpm run pipeline people --state US',
    ]);
    expect(runs(base, 'housekeeping')).toEqual(['pnpm run pipeline housekeeping']);
    expect(runs(base, 'coops')).toEqual(['pnpm run pipeline coops --state "$STATES"']);
  });

  it('every job takes its states from the dispatch input, all by default', () => {
    for (const [id, entry] of Object.entries(base.jobs)) {
      expect(entry.env?.STATES, id).toBe("${{ inputs.states || 'all' }}");
    }
  });

  it('only the people job receives FEC_API_KEY', () => {
    expect(base.env).toBeUndefined();
    for (const [id, entry] of Object.entries(base.jobs)) {
      const mentions = JSON.stringify(entry).includes('FEC_API_KEY');
      expect(mentions, id).toBe(id === 'people');
    }
    expect(job(base, 'people').env?.FEC_API_KEY).toBe('${{ secrets.FEC_API_KEY }}');
    expect(JSON.stringify(bundle)).not.toContain('FEC_API_KEY');
  });
});

describe('pipeline-bundle.yml', () => {
  it("pipeline-bundle.yml has '7 9 * * *' and no push trigger", () => {
    expect(bundle.on.schedule.map((entry) => entry.cron)).toEqual(['7 9 * * *']);
    expect(Object.keys(bundle.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const inputs = bundle.on.workflow_dispatch.inputs;
    expect(inputs.kind).toMatchObject({
      type: 'choice',
      options: ['full', 'geometry'],
      default: 'full',
    });
    expect(inputs.states).toMatchObject({ type: 'string', default: 'all' });
  });

  it('has one job, bundle, with its time limit', () => {
    expect(Object.keys(bundle.jobs)).toEqual(['bundle']);
    expect(job(bundle, 'bundle').if).toBe(READY);
    expect(job(bundle, 'bundle')['timeout-minutes']).toBe(240);
  });

  it('the bundle job runs the rules tests before the bundle', () => {
    const steps = job(bundle, 'bundle').steps;
    const rules = steps.findIndex((step) => step.run === 'pnpm --filter @citizenrun/rules test');
    const write = steps.findIndex(
      (step) => step.run?.startsWith('pnpm run pipeline bundle ') === true,
    );
    expect(rules).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(rules);
    expect(steps[write]).toEqual({
      env: { KIND: "${{ inputs.kind || 'full' }}", STATES: "${{ inputs.states || 'all' }}" },
      run: 'pnpm run pipeline bundle --kind "$KIND" --state "$STATES"',
    });
  });
});

describe('both pipeline workflows', () => {
  it('every job runs on ubuntu-24.04 in the staging Environment with the RAILWAY_STAGING_READY condition', () => {
    for (const [file, flow] of BOTH) {
      for (const [id, entry] of Object.entries(flow.jobs)) {
        expect(entry['runs-on'], `${file} ${id}`).toBe('ubuntu-24.04');
        expect(entry.environment, `${file} ${id}`).toBe('staging');
        expect(entry.if, `${file} ${id}`).toContain(READY);
      }
    }
  });

  it('every job sets timeout-minutes of at most 360', () => {
    for (const [file, flow] of BOTH) {
      for (const [id, entry] of Object.entries(flow.jobs)) {
        const minutes = entry['timeout-minutes'];
        expect(Number.isInteger(minutes) && minutes > 0 && minutes <= 360, `${file} ${id}`).toBe(
          true,
        );
      }
    }
  });

  it('every job checks out, sets up, then runs its commands', () => {
    for (const [file, flow] of BOTH) {
      for (const [id, entry] of Object.entries(flow.jobs)) {
        expect(entry.steps[0]?.uses, `${file} ${id}`).toMatch(/^actions\/checkout@/);
        expect(entry.steps[1]?.uses, `${file} ${id}`).toBe('./.github/actions/setup');
        for (const step of entry.steps.slice(2)) {
          expect(step.uses, `${file} ${id}`).toBeUndefined();
          expect(step.run, `${file} ${id}`).toMatch(/^pnpm /);
        }
      }
    }
  });

  it('every job has the data bucket and the run id, and secrets only from the Environment', () => {
    for (const [file, flow] of BOTH) {
      for (const [id, entry] of Object.entries(flow.jobs)) {
        expect(entry.env, `${file} ${id}`).toMatchObject({
          DATA_BUCKET: '${{ vars.DATA_BUCKET }}',
          DATA_ENDPOINT: '${{ vars.DATA_ENDPOINT }}',
          DATA_REGION: '${{ vars.DATA_REGION }}',
          DATA_ACCESS_KEY_ID: '${{ secrets.DATA_ACCESS_KEY_ID }}',
          DATA_SECRET_ACCESS_KEY: '${{ secrets.DATA_SECRET_ACCESS_KEY }}',
          PIPELINE_RUN_ID: '${{ github.run_id }}-${{ github.run_attempt }}',
        });
      }
    }
  });

  it('uses only actions pinned to a 40-character SHA', () => {
    for (const [file, flow] of BOTH) {
      for (const entry of Object.values(flow.jobs)) {
        for (const step of entry.steps) {
          if (step.uses !== undefined && !step.uses.startsWith('./')) {
            expect(step.uses, file).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/);
          }
        }
      }
      for (const line of text(file)
        .split('\n')
        .filter((row) => /uses: (?!\.\/)/.test(row))) {
        expect(line, file).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    }
  });

  it('permissions are read-only at the top and the concurrency group is the file name with cancel-in-progress false', () => {
    for (const [file, flow] of BOTH) {
      expect(flow.permissions, file).toEqual({ contents: 'read' });
      // The workflow's name is its file name without `.yml`, and check-workflows requires the
      // group to equal that name.
      expect(flow.name, file).toBe(file.replace(/\.yml$/, ''));
      expect(flow.concurrency, file).toEqual({ group: flow.name, 'cancel-in-progress': false });
      for (const [id, entry] of Object.entries(flow.jobs)) {
        expect(entry.permissions, `${file} ${id}`).toBeUndefined();
      }
    }
  });

  it('no job uploads an artifact', () => {
    for (const [file, flow] of BOTH) {
      expect(text(file), file).not.toContain('upload-artifact');
      for (const entry of Object.values(flow.jobs)) {
        for (const step of entry.steps) {
          expect(step.uses ?? '', file).not.toMatch(/artifact/);
        }
      }
    }
  });

  it('a job condition names only a cron the workflow schedules', () => {
    for (const [file, flow] of BOTH) {
      const crons = new Set(flow.on.schedule.map((entry) => entry.cron));
      for (const entry of Object.values(flow.jobs)) {
        for (const match of entry.if.matchAll(/github\.event\.schedule == '([^']*)'/g)) {
          expect(crons.has(match[1] ?? ''), file).toBe(true);
        }
      }
    }
  });

  it('holds no pull_request_target and no secret value', () => {
    for (const [file] of BOTH) {
      const body = text(file);
      expect(body, file).not.toContain('pull_request_target');
      // Every secret is read from the Environment by name; no value is written in the file.
      for (const line of body.split('\n').filter((row) => /secret|token|password/i.test(row))) {
        expect(line, file).toMatch(/\$\{\{ secrets\.[A-Z_]+ \}\}|POSTGRES_PASSWORD: citizenrun/);
      }
    }
  });
});
