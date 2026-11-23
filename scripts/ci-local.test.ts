import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  CI_JOBS,
  NIGHTLY_JOBS,
  NO_LOCAL_FORM,
  UsageError,
  ciRange,
  gitleaksAssetFor,
  median,
  parseCiLocalArgs,
  readDurations,
  readGitleaksPin,
  selectJobs,
} from './ci-local.ts';
import { repoRoot } from './lib/repo-root.ts';
import { createFakeCli } from './testing/fake-cli.ts';
import type { FakeCli } from './testing/fake-cli.ts';

const ROOT = repoRoot();

function workflowJobs(file: string): string[] {
  const workflow = z
    .object({ jobs: z.record(z.string(), z.unknown()) })
    .parse(parse(readFileSync(join(ROOT, '.github/workflows', file), 'utf8')));
  return Object.keys(workflow.jobs);
}

function names(args: readonly string[]): string[] {
  return selectJobs(parseCiLocalArgs(args)).map((job) => job.name);
}

describe('ci-local', () => {
  it('the ci jobs are exactly the workflow jobs, in order', () => {
    expect(workflowJobs('ci.yml')).toEqual(CI_JOBS.map((job) => job.name));
    expect(CI_JOBS.map((job) => job.name)).toEqual([
      'static',
      'unit',
      'integration',
      'web',
      'images',
      'e2e',
      'audit',
      'secrets',
    ]);
    expect(CI_JOBS.every((job) => job.workflow === 'ci')).toBe(true);
  });

  it('the nightly jobs are the workflow jobs other than bucket-smoke', () => {
    const jobs = workflowJobs('nightly.yml');
    expect(jobs).toContain('bucket-smoke');
    expect(jobs.filter((name) => !(NO_LOCAL_FORM as readonly string[]).includes(name))).toEqual(
      NIGHTLY_JOBS.map((job) => job.name),
    );
    expect(NIGHTLY_JOBS.every((job) => job.workflow === 'nightly')).toBe(true);
  });

  it('checks pg_dump 17 before the jobs that dump or restore', () => {
    const needing = [...CI_JOBS, ...NIGHTLY_JOBS]
      .filter((job) => job.needsPgDump17)
      .map((job) => job.name);
    expect(needing).toEqual(['integration', 'images', 'verify']);
  });

  it('selection follows the flags', () => {
    expect(names([])).toEqual(CI_JOBS.map((job) => job.name));
    expect(names(['--nightly'])).toEqual(['verify']);
    expect(names(['--job', 'audit,secrets,images'])).toEqual(['images', 'audit', 'secrets']);
    expect(names(['--job', 'verify'])).toEqual(['verify']);
    expect(names(['--nightly', '--job', 'verify'])).toEqual(['verify']);
    expect(names(['--job', 'unit', '--job', 'static'])).toEqual(['static', 'unit']);
  });

  it('an unknown job is a usage error naming the valid jobs', () => {
    const attempt = (): unknown => selectJobs(parseCiLocalArgs(['--job', 'lint']));
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(
      'unknown job lint; valid jobs: static, unit, integration, web, images, e2e, audit, secrets, verify',
    );
  });

  it('with --nightly only nightly jobs are accepted', () => {
    expect(() => selectJobs(parseCiLocalArgs(['--nightly', '--job', 'unit']))).toThrow(
      'unknown job unit; valid jobs: verify',
    );
  });

  it('bucket-smoke has no local form', () => {
    for (const argv of [
      ['--job', 'bucket-smoke'],
      ['--nightly', '--job', 'bucket-smoke'],
    ]) {
      expect(() => selectJobs(parseCiLocalArgs(argv))).toThrow(
        new UsageError(
          'bucket-smoke has no local form: it runs on GitHub once staging exists (OI-railway, OI-github-actions)',
        ),
      );
    }
  });

  it('the base defaults to main', () => {
    expect(parseCiLocalArgs([]).base).toBe('main');
    expect(parseCiLocalArgs(['--base', 'stage/x']).base).toBe('stage/x');
    expect(ciRange('main')).toBe('main..HEAD');
  });

  it('parses the flags and refuses unknown ones', () => {
    expect(
      parseCiLocalArgs(['--update-snapshots', '--keep-going', '--durations', '--nightly']),
    ).toEqual({
      nightly: true,
      jobs: null,
      base: 'main',
      updateSnapshots: true,
      keepGoing: true,
      durations: true,
    });
    expect(() => parseCiLocalArgs(['--fast'])).toThrow(UsageError);
    expect(() => parseCiLocalArgs(['--job'])).toThrow('--job needs a value');
    expect(() => parseCiLocalArgs(['--base', '--keep-going'])).toThrow('--base needs a value');
  });

  it('the gitleaks asset follows the host', () => {
    expect(gitleaksAssetFor('darwin', 'arm64')).toBe('darwin-arm64');
    expect(gitleaksAssetFor('darwin', 'x64')).toBe('darwin-x64');
    expect(gitleaksAssetFor('linux', 'x64')).toBe('linux-x64');
    expect(() => gitleaksAssetFor('win32', 'x64')).toThrow();
    expect(() => gitleaksAssetFor('linux', 'arm64')).toThrow();
  });

  it('the gitleaks pin is complete', () => {
    const pin = readGitleaksPin(ROOT);
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/);
    const prefix = `https://github.com/gitleaks/gitleaks/releases/download/v${pin.version}/`;
    const files = {
      'linux-x64': 'linux_x64',
      'darwin-arm64': 'darwin_arm64',
      'darwin-x64': 'darwin_x64',
    } as const;
    for (const [key, suffix] of Object.entries(files)) {
      const asset = pin.assets[key as keyof typeof files];
      expect(asset.url, key).toBe(`${prefix}gitleaks_${pin.version}_${suffix}.tar.gz`);
      expect(asset.sha256, key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(() => median([])).toThrow();
  });
});

describe('the durations figure', () => {
  let fake: FakeCli | null = null;
  let folder: string | null = null;

  afterEach(async () => {
    await fake?.cleanup();
    fake = null;
    if (folder !== null) {
      rmSync(folder, { recursive: true, force: true });
      folder = null;
    }
  });

  function runsFileWith(lines: readonly unknown[]): string {
    folder = mkdtempSync(join(tmpdir(), 'ci-local-test-'));
    const file = join(folder, 'runs.jsonl');
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\nnot json\n');
    return file;
  }

  const job = (name: string, result: 'pass' | 'fail', seconds: number) => ({
    job: name,
    result,
    seconds,
  });

  it('reads the local record when gh is not signed in', async () => {
    fake = await createFakeCli({ gh: [{ args: ['auth', 'status'], exitCode: 1 }] });
    const file = runsFileWith([
      {
        at: 'x',
        head: 'h',
        nightly: false,
        jobs: [job('static', 'pass', 100), job('unit', 'pass', 30)],
      },
      {
        at: 'x',
        head: 'h',
        nightly: false,
        jobs: [job('static', 'fail', 999), job('unit', 'pass', 50)],
      },
      {
        at: 'x',
        head: 'h',
        nightly: false,
        jobs: [job('static', 'pass', 300), job('audit', 'pass', 5)],
      },
    ]);
    const report = await readDurations({
      env: fake.env({ PATH: process.env.PATH }),
      runsFile: file,
      machine: 'darwin-arm64, 8 CPUs',
    });
    expect(report).toEqual({
      environment: 'local',
      machine: 'darwin-arm64, 8 CPUs',
      static: { runs: 2, medianSeconds: 200 },
      unit: { runs: 2, medianSeconds: 40 },
      budgetSeconds: 600,
      withinBudget: true,
    });
    expect(fake.calls().map((call) => call.args)).toEqual([['auth', 'status']]);
  });

  it('keeps the last ten passing runs of each job', async () => {
    fake = await createFakeCli({ gh: [{ args: ['auth', 'status'], exitCode: 1 }] });
    const lines = Array.from({ length: 12 }, (_, index) => ({
      at: 'x',
      head: 'h',
      nightly: false,
      jobs: [job('static', 'pass', index + 1), job('unit', 'pass', 700)],
    }));
    const report = await readDurations({
      env: fake.env({ PATH: process.env.PATH }),
      runsFile: runsFileWith(lines),
      machine: 'm',
    });
    expect(report.static).toEqual({ runs: 10, medianSeconds: 7.5 });
    expect(report.unit).toEqual({ runs: 10, medianSeconds: 700 });
    expect(report.withinBudget).toBe(false);
  });

  it('reads GitHub runs when gh is signed in and ci.yml has run on main', async () => {
    const jobs = (staticSeconds: number, unitSeconds: number): string =>
      JSON.stringify({
        jobs: [
          {
            name: 'static',
            startedAt: '2026-11-01T10:00:00Z',
            completedAt: new Date(
              Date.parse('2026-11-01T10:00:00Z') + staticSeconds * 1000,
            ).toISOString(),
          },
          {
            name: 'unit',
            startedAt: '2026-11-01T10:00:00Z',
            completedAt: new Date(
              Date.parse('2026-11-01T10:00:00Z') + unitSeconds * 1000,
            ).toISOString(),
          },
        ],
      });
    fake = await createFakeCli({
      gh: [
        { args: ['auth', 'status'] },
        {
          args: [
            'run',
            'list',
            '--workflow',
            'ci.yml',
            '--branch',
            'main',
            '--status',
            'success',
            '--limit',
            '10',
            '--json',
            'databaseId',
          ],
          stdout: JSON.stringify([{ databaseId: 11 }, { databaseId: 12 }]),
        },
        { args: ['run', 'view', '11', '--json', 'jobs'], stdout: jobs(120, 60) },
        { args: ['run', 'view', '12', '--json', 'jobs'], stdout: jobs(240, 90) },
      ],
    });
    const report = await readDurations({
      env: fake.env({ PATH: process.env.PATH }),
      runsFile: runsFileWith([]),
      machine: 'm',
    });
    expect(report).toEqual({
      environment: 'github',
      machine: 'm',
      static: { runs: 2, medianSeconds: 180 },
      unit: { runs: 2, medianSeconds: 75 },
      budgetSeconds: 600,
      withinBudget: true,
    });
    expect(fake.calls().every((call) => call.matched)).toBe(true);
  });

  it('falls back to the local record when GitHub has no successful run', async () => {
    fake = await createFakeCli({
      gh: [
        { args: ['auth', 'status'] },
        {
          args: ['run', 'list', /.*/, /.*/, /.*/, /.*/, /.*/, /.*/, /.*/, /.*/, /.*/, /.*/],
          stdout: '[]',
        },
      ],
    });
    const report = await readDurations({
      env: fake.env({ PATH: process.env.PATH }),
      runsFile: runsFileWith([]),
      machine: 'm',
    });
    expect(report.environment).toBe('local');
    expect(report.static).toEqual({ runs: 0, medianSeconds: null });
    expect(report.withinBudget).toBe(false);
  });
});
