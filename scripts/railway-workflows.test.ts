import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from './lib/repo-root.ts';

const WORKFLOW = '.github/workflows/railway-config.yml';
const PLAN_COMMAND = 'pnpm exec railway config plan --out railway-plan.json';

type YamlMap = Record<string, unknown>;

function isMap(value: unknown): value is YamlMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asMap(value: unknown, what: string): YamlMap {
  if (!isMap(value)) {
    throw new Error(`${what} is not a map`);
  }
  return value;
}

function workflow(): YamlMap {
  return asMap(parse(readFileSync(join(repoRoot(), WORKFLOW), 'utf8')) as unknown, WORKFLOW);
}

function jobSteps(job: unknown): YamlMap[] {
  const steps = isMap(job) ? job.steps : undefined;
  return Array.isArray(steps) ? steps.filter(isMap) : [];
}

function allSteps(): YamlMap[] {
  return Object.values(asMap(workflow().jobs, 'jobs')).flatMap(jobSteps);
}

function usesAction(step: YamlMap, action: string): boolean {
  return typeof step.uses === 'string' && step.uses.startsWith(`${action}@`);
}

function withInputs(step: YamlMap): YamlMap {
  return isMap(step.with) ? step.with : {};
}

function envOf(step: YamlMap): YamlMap {
  return isMap(step.env) ? step.env : {};
}

describe('railway-config workflow', () => {
  it('applies the reviewed plan with the pinned CLI and hands no token to an action', () => {
    expect(allSteps().filter((step) => usesAction(step, 'railwayapp/config'))).toEqual([]);
    const steps = jobSteps(asMap(workflow().jobs, 'jobs')['apply-staging']);
    const download = steps.findIndex((step) => step.name === 'Download the reviewed plan');
    const apply = steps.findIndex(
      (step) => step.run === 'pnpm exec railway config apply --plan railway-plan.json --yes',
    );
    expect(download).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(download);
    expect(envOf(steps[apply] ?? {}).RAILWAY_TOKEN).toMatch(
      /^\$\{\{\s*secrets\.RAILWAY_TOKEN_STAGING\s*\}\}$/,
    );
    expect(String(steps[download]?.run)).toContain('railway-plan-staging');
    // A commit with no merged pull request skips the apply instead of failing the push.
    expect(steps[download]?.id).toBe('reviewed');
    expect(String(steps[download]?.run)).toContain('found=false');
    expect(String(steps[apply]?.if)).toBe("steps.reviewed.outputs.found == 'true'");
    // A step that is given a secret runs a command of this repository, never an action.
    for (const step of allSteps()) {
      if (JSON.stringify({ with: step.with, env: step.env }).includes('secrets.')) {
        expect(step.uses, String(step.name)).toBeUndefined();
      }
    }
  });

  it('plans the pull request with the pinned CLI and uploads the plan for the apply job', () => {
    const steps = jobSteps(asMap(workflow().jobs, 'jobs')['plan-staging']);
    const plan = steps.filter(
      (step) => typeof step.run === 'string' && step.run.includes(PLAN_COMMAND),
    );
    expect(plan).toHaveLength(1);
    expect(envOf(plan[0] ?? {}).RAILWAY_TOKEN).toMatch(
      /^\$\{\{\s*secrets\.RAILWAY_TOKEN_STAGING\s*\}\}$/,
    );
    const uploads = steps.filter((step) => usesAction(step, 'actions/upload-artifact'));
    expect(uploads).toHaveLength(1);
    const upload = withInputs(uploads[0] ?? {});
    expect(upload.name).toBe('railway-plan-staging');
    expect(upload.path).toBe('railway-plan.json');
    expect(upload['if-no-files-found']).toBe('error');
    expect(steps.indexOf(plan[0] ?? {})).toBeLessThan(steps.indexOf(uploads[0] ?? {}));
  });

  it('passes no flag that prints values or allows a destructive change on any run line', () => {
    const runLines = allSteps().flatMap((step) =>
      typeof step.run === 'string' ? step.run.split('\n') : [],
    );
    const planRunSteps = jobSteps(asMap(workflow().jobs, 'jobs')['plan-staging']).filter(
      (step) => typeof step.run === 'string',
    );
    expect(planRunSteps.length).toBeGreaterThan(0);
    for (const line of runLines) {
      expect(line).not.toContain('--show-values');
      expect(line).not.toContain('--confirm-destructive');
    }
  });

  it('passes event values to the plan comment through env, not into the script', () => {
    const steps = jobSteps(asMap(workflow().jobs, 'jobs')['plan-staging']);
    for (const step of steps) {
      if (typeof step.run === 'string') {
        expect(step.run).not.toContain('${{');
      }
    }
  });
});
