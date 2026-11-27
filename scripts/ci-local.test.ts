import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { BRAND, JOB_POLICIES } from '@citizenrun/shared';
import {
  ANDROID_API_ORIGIN,
  CI_JOBS,
  IMAGE_SMOKES,
  MIN_FREE_BYTES_FOR_IMAGES,
  NIGHTLY_JOBS,
  NO_LOCAL_FORM,
  UsageError,
  availableBytes,
  ciRange,
  descendantsOf,
  freeSpaceFailure,
  gitleaksAssetFor,
  median,
  parseCiLocalArgs,
  readDurations,
  readGitleaksPin,
  selectJobs,
  showLogsAndRemove,
  startChild,
  stopChild,
  WORKER_CONTAINER,
  adbListsEmulator,
  androidBuildEnv,
  logEvents,
  maestroTestArgs,
  migrationCompatArgs,
  parseQueueRows,
  productQueues,
  pushConfigured,
  seedFactArgs,
  workerQueuesFailure,
  workerRunArgs,
  workerStartState,
  workerStopFailure,
} from './ci-local.ts';
import type { QueueRow } from './ci-local.ts';
import { repoRoot } from './lib/repo-root.ts';
import { createFakeCli } from './testing/fake-cli.ts';
import type { FakeCli } from './testing/fake-cli.ts';
import type { RunResult } from './lib/exec.ts';

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

  it('the nightly jobs match the workflow', () => {
    const jobs = workflowJobs('nightly.yml');
    expect(jobs).toContain('bucket-smoke');
    expect(jobs.filter((name) => !(NO_LOCAL_FORM as readonly string[]).includes(name))).toEqual(
      NIGHTLY_JOBS.map((job) => job.name),
    );
    expect(NIGHTLY_JOBS.map((job) => job.name)).toEqual([
      'verify',
      'migration-compat',
      'maestro-android',
    ]);
    expect(NIGHTLY_JOBS.every((job) => job.workflow === 'nightly')).toBe(true);
  });

  it('checks pg_dump 17 before the jobs that dump or restore', () => {
    const needing = [...CI_JOBS, ...NIGHTLY_JOBS]
      .filter((job) => job.needsPgDump17)
      .map((job) => job.name);
    expect(needing).toEqual(['integration', 'images', 'verify', 'migration-compat']);
  });

  it('selection follows the flags', () => {
    expect(names([])).toEqual(CI_JOBS.map((job) => job.name));
    expect(names(['--nightly'])).toEqual(['verify', 'migration-compat', 'maestro-android']);
    expect(names(['--nightly', '--job', 'verify,migration-compat'])).toEqual([
      'verify',
      'migration-compat',
    ]);
    expect(names(['--job', 'maestro-android'])).toEqual(['maestro-android']);
    expect(names(['--job', 'audit,secrets,images'])).toEqual(['images', 'audit', 'secrets']);
    expect(names(['--job', 'verify'])).toEqual(['verify']);
    expect(names(['--nightly', '--job', 'verify'])).toEqual(['verify']);
    expect(names(['--job', 'unit', '--job', 'static'])).toEqual(['static', 'unit']);
  });

  it('an unknown job is a usage error naming the valid jobs', () => {
    const attempt = (): unknown => selectJobs(parseCiLocalArgs(['--job', 'lint']));
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(
      'unknown job lint; valid jobs: static, unit, integration, web, images, e2e, audit, secrets, verify, migration-compat, maestro-android',
    );
  });

  it('with --nightly only nightly jobs are accepted', () => {
    expect(() => selectJobs(parseCiLocalArgs(['--nightly', '--job', 'unit']))).toThrow(
      'unknown job unit; valid jobs: verify, migration-compat, maestro-android',
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

  it('a job that builds images stops first on a nearly full host volume', () => {
    const gib = 1024 ** 3;
    expect(MIN_FREE_BYTES_FOR_IMAGES).toBe(5 * gib);
    expect(freeSpaceFailure(MIN_FREE_BYTES_FOR_IMAGES)).toBeNull();
    expect(freeSpaceFailure(40 * gib)).toBeNull();
    expect(freeSpaceFailure(1.7 * gib)).toBe(
      "only 1.7 GiB free on the host volume; building images needs at least 5.0 GiB, or the Docker engine's store can fail with input/output errors. Free space on the host, then run the job again.",
    );
    expect(freeSpaceFailure(3 * gib, 2 * gib)).toBeNull();
    expect(freeSpaceFailure(0, 1)).toMatch(/^only 0\.0 GiB free/);
  });

  it('reads the free space of the volume that holds the repository', () => {
    const bytes = availableBytes(ROOT);
    expect(Number.isSafeInteger(bytes)).toBe(true);
    expect(bytes).toBeGreaterThan(0);
  });

  it('the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(() => median([])).toThrow();
  });
});

describe('the nightly local forms', () => {
  let folder: string | null = null;

  afterEach(() => {
    if (folder !== null) {
      rmSync(folder, { recursive: true, force: true });
      folder = null;
    }
  });

  it('migration-compat passes the base', async () => {
    expect(migrationCompatArgs(parseCiLocalArgs(['--base', 'abc']).base)).toEqual([
      'exec',
      'tsx',
      'scripts/migration-compat.ts',
      '--base',
      'abc',
    ]);
    expect(migrationCompatArgs(parseCiLocalArgs([]).base)).toContain('main');
    expect(migrationCompatArgs(parseCiLocalArgs([]).base).slice(-2)).toEqual(['--base', 'main']);

    // The job itself, with a stand-in pnpm on PATH that records its arguments.
    folder = mkdtempSync(join(tmpdir(), 'ci-local-compat-'));
    const record = join(folder, 'args.txt');
    const shim = join(folder, 'pnpm');
    writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`);
    chmodSync(shim, 0o755);
    const job = NIGHTLY_JOBS.find((entry) => entry.name === 'migration-compat');
    await job?.run({
      root: ROOT,
      base: 'abc',
      updateSnapshots: false,
      env: { PATH: `${folder}:/usr/bin:/bin`, TZ: 'UTC' },
    });
    expect(readFileSync(record, 'utf8').trim().split('\n')).toEqual([
      'exec',
      'tsx',
      'scripts/migration-compat.ts',
      '--base',
      'abc',
    ]);
  });

  it('maestro-android passes the development identifiers', () => {
    const brand = z
      .object({
        variants: z.object({
          development: z.object({ androidPackage: z.string(), scheme: z.string() }),
        }),
      })
      .parse(JSON.parse(readFileSync(join(ROOT, 'brand.json'), 'utf8')));
    const development = brand.variants.development;
    const args = maestroTestArgs({ env: {}, projectId: null, facts: {} });
    expect(args.slice(0, 2)).toEqual(['test', 'apps/mobile/.maestro']);
    expect(args).toContain(`APP_ID=${development.androidPackage}`);
    expect(args).toContain(`APP_SCHEME=${development.scheme}`);
    expect(BRAND.variants.development.androidPackage).toBe(development.androidPackage);
    // Read from the brand module, never written into the script.
    const source = readFileSync(join(ROOT, 'scripts/ci-local.ts'), 'utf8');
    expect(source).not.toContain(development.androidPackage);
    expect(source).not.toContain(`'${development.scheme}'`);

    expect(
      seedFactArgs({ officeWithDeadline: 'office one', durhamPoint: { lat: 36, lng: -78.9 } }),
    ).toEqual(['-e', 'officeWithDeadline=office one', '-e', 'durhamPoint={"lat":36,"lng":-78.9}']);
    const withFacts = maestroTestArgs({ env: {}, projectId: null, facts: { handle: 'seed' } });
    expect(withFacts.slice(-2)).toEqual(['-e', 'handle=seed']);

    expect(androidBuildEnv({})).toEqual({
      APP_VARIANT: 'development',
      EXPO_PUBLIC_API_ORIGIN: ANDROID_API_ORIGIN,
    });
    expect(ANDROID_API_ORIGIN).toBe('http://10.0.2.2:8080');
    expect(adbListsEmulator('List of devices attached\nemulator-5554\tdevice\n')).toBe(true);
    expect(adbListsEmulator('List of devices attached\nemulator-5554\toffline\n')).toBe(false);
    expect(adbListsEmulator('List of devices attached\nR58M12345\tdevice\n')).toBe(false);
  });

  it('push is off without a Firebase file', () => {
    expect(pushConfigured('fixture-project-id', {})).toBe(false);
    expect(pushConfigured('fixture-project-id', { GOOGLE_SERVICES_JSON: '' })).toBe(false);
    expect(pushConfigured(null, { GOOGLE_SERVICES_JSON: '/fixture/google-services.json' })).toBe(
      false,
    );
    expect(
      pushConfigured('fixture-project-id', {
        GOOGLE_SERVICES_JSON: '/fixture/google-services.json',
      }),
    ).toBe(true);
    expect(maestroTestArgs({ env: {}, projectId: BRAND.expo.projectId, facts: {} })).toContain(
      'PUSH_CONFIGURED=false',
    );
    expect(
      maestroTestArgs({
        env: { GOOGLE_SERVICES_JSON: '/fixture/google-services.json' },
        projectId: 'fixture-project-id',
        facts: {},
      }),
    ).toContain('PUSH_CONFIGURED=true');
    // The Firebase file reaches the build only when the shell holds it.
    expect(androidBuildEnv({})).not.toHaveProperty('GOOGLE_SERVICES_JSON');
    expect(androidBuildEnv({ GOOGLE_SERVICES_JSON: '' })).not.toHaveProperty(
      'GOOGLE_SERVICES_JSON',
    );
    expect(
      androidBuildEnv({ GOOGLE_SERVICES_JSON: '/fixture/google-services.json' })
        .GOOGLE_SERVICES_JSON,
    ).toBe('/fixture/google-services.json');
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

describe('the api smoke clean-up', () => {
  it("prints the container's log to the terminal whatever its exit, then removes it", async () => {
    const calls: { args: readonly string[]; inherit: boolean }[] = [];
    const exec = (
      _command: string,
      args: readonly string[],
      options?: { inherit?: boolean },
    ): Promise<RunResult> => {
      calls.push({ args, inherit: options?.inherit === true });
      return Promise.resolve({ code: args[0] === 'logs' ? 1 : 0, stdout: '', stderr: '' });
    };
    await showLogsAndRemove({ root: ROOT, env: {} }, 'fixture-container', exec);
    expect(calls).toEqual([
      { args: ['logs', 'fixture-container'], inherit: true },
      { args: ['rm', '-f', 'fixture-container'], inherit: false },
    ]);
  });

  it('removes the container when docker logs cannot start', async () => {
    const calls: string[] = [];
    const exec = (_command: string, args: readonly string[]): Promise<RunResult> => {
      calls.push(args.join(' '));
      return args[0] === 'logs'
        ? Promise.reject(new Error('spawn docker ENOENT'))
        : Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    await showLogsAndRemove({ root: ROOT, env: {} }, 'fixture-container', exec);
    expect(calls).toEqual(['logs fixture-container', 'rm -f fixture-container']);
  });
});

describe('the worker smoke', () => {
  const line = (event: string, fields: Record<string, unknown> = {}): string =>
    JSON.stringify({
      time: '2026-11-25T10:00:00.000Z',
      level: 'info',
      service: 'worker',
      event,
      ...fields,
    });

  const registryRows = (): QueueRow[] =>
    Object.entries(JOB_POLICIES).map(([name, policy]) => ({
      name,
      policy,
      scheduled: policy === 'stately',
    }));

  it('the images job runs the api, worker and backup smokes in that order', () => {
    expect(IMAGE_SMOKES.map((smoke) => smoke.name)).toEqual(['api', 'worker', 'backup']);
  });

  it('starts the worker image on the compose network against the smoke database', () => {
    const args = workerRunArgs();
    expect(WORKER_CONTAINER).toBe('citizenrun-ci-worker');
    expect(args.slice(0, 6)).toEqual([
      'run',
      '-d',
      '--name',
      'citizenrun-ci-worker',
      '--network',
      'citizenrun_default',
    ]);
    expect(args.at(-1)).toBe('citizenrun-worker:local');
    expect(args).not.toContain('--rm');
    expect(args).not.toContain('-p');
    expect(args).toContain('APP_ENV=ci');
    expect(args).toContain(
      'DATABASE_URL=postgresql://citizenrun:citizenrun@postgres:5432/citizenrun_ci',
    );
    expect(args).toContain('BACKUPS_ENDPOINT=http://seaweedfs:8333');
    expect(args).toContain('DATA_ENDPOINT=http://seaweedfs:8333');
    expect(args).toContain('DATA_BUCKET=data');
  });

  it('reads the JSON log lines and skips any other line', () => {
    const output = [
      line('worker.started', { queueCount: 6 }),
      'node: warning',
      '',
      '{"no":1}',
    ].join('\n');
    const events = logEvents(output);
    expect(events.map((entry) => entry.event)).toEqual(['worker.started']);
    expect(events[0]?.fields.queueCount).toBe(6);
  });

  it('waits for worker.started and fails on a failed boot', () => {
    expect(workerStartState(logEvents(line('env.input_missing')))).toBe('waiting');
    expect(workerStartState(logEvents(line('worker.started')))).toBe('started');
    for (const event of ['env.invalid', 'worker.start_failed', 'worker.crashed']) {
      expect(workerStartState(logEvents(line(event))), event).toBe('failed');
    }
  });

  it('parses the queue rows psql prints', () => {
    expect(parseQueueRows('cost.check|stately|t\nops.dead|standard|f\n\n')).toEqual([
      { name: 'cost.check', policy: 'stately', scheduled: true },
      { name: 'ops.dead', policy: 'standard', scheduled: false },
    ]);
  });

  it('passes the queues only when every registry queue holds its policy and the scheduled ones pile up nothing', () => {
    const rows = registryRows();
    expect(rows.filter((row) => row.scheduled).map((row) => row.name)).toEqual([
      'ops.heartbeat',
      'backup.check',
      'db.connections-check',
      'cost.check',
      'cleanup.retention',
      'db.size-check',
      'field-reports.export',
    ]);
    expect(workerQueuesFailure(rows)).toBeNull();
    const clock = { name: '__pgboss__send-it', policy: 'standard', scheduled: false };
    expect(workerQueuesFailure([...rows, clock])).toBeNull();
    expect(productQueues([...rows, clock])).toEqual(rows);
    expect(workerQueuesFailure(rows.filter((row) => row.name !== 'cost.check'))).toBe(
      'worker smoke: queue cost.check was not created',
    );
    expect(
      workerQueuesFailure(
        rows.map((row) => (row.name === 'ops.heartbeat' ? { ...row, policy: 'standard' } : row)),
      ),
    ).toBe('worker smoke: queue ops.heartbeat is standard, not stately');
    expect(
      workerQueuesFailure([...rows, { name: 'x.y', policy: 'standard', scheduled: false }]),
    ).toBe('worker smoke: queue x.y is not in JOB_POLICIES');
    expect(workerQueuesFailure(rows.map((row) => ({ ...row, scheduled: false })))).toBe(
      'worker smoke: no queue holds a schedule',
    );
    expect(
      workerQueuesFailure([{ name: 'a', policy: 'standard', scheduled: true }], { a: 'standard' }),
    ).toBe('worker smoke: scheduled queue a is standard');
    expect(
      workerQueuesFailure([{ name: 'score.issues', policy: 'standard', scheduled: true }], {
        'score.issues': 'standard',
      }),
    ).toBeNull();
  });

  it('passes the stop only on exit 0 with worker.stopping for SIGTERM, then worker.stopped', () => {
    const clean = logEvents(
      [
        line('worker.started'),
        line('worker.stopping', { signal: 'SIGTERM' }),
        line('worker.stopped'),
      ].join('\n'),
    );
    expect(workerStopFailure(clean, 0)).toBeNull();
    expect(workerStopFailure(clean, 137)).toBe('worker smoke: the worker exited 137 after SIGTERM');
    expect(
      workerStopFailure(
        logEvents(
          [line('worker.stopping', { signal: 'SIGINT' }), line('worker.stopped')].join('\n'),
        ),
        0,
      ),
    ).toBe('worker smoke: no worker.stopping line with signal SIGTERM');
    expect(
      workerStopFailure(
        logEvents(
          [line('worker.stopped'), line('worker.stopping', { signal: 'SIGTERM' })].join('\n'),
        ),
        0,
      ),
    ).toBe('worker smoke: no worker.stopped line after worker.stopping');
    expect(
      workerStopFailure(
        logEvents(
          [
            line('worker.stopping', { signal: 'SIGTERM' }),
            line('worker.stop_failed'),
            line('worker.stopped'),
          ].join('\n'),
        ),
        0,
      ),
    ).toBe('worker smoke: the worker logged worker.stop_failed');
  });
});

/** Whether a process is running: listed by `ps` and not a zombie. */
function isRunning(pid: number): boolean {
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
      .trim()
      .startsWith('Z');
  } catch {
    return false;
  }
}

async function pidWrittenTo(file: string): Promise<number> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (/^\d+$/.test(text)) {
      return Number(text);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the child wrote no pid');
}

describe('a long-running child of a job', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds every process under it, at any depth', () => {
    const listing = [
      '    1     0',
      '   10     1',
      '   11    10',
      '   12    11',
      '   13    10',
      '   20     1',
      '',
    ].join('\n');
    expect(descendantsOf(listing, 10)).toEqual([11, 13, 12]);
    expect(descendantsOf(listing, 12)).toEqual([]);
    expect(descendantsOf('', 10)).toEqual([]);
  });

  it('stopping it stops the processes it started too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-local-child-'));
    dirs.push(dir);
    const pidFile = join(dir, 'grandchild.pid');
    const ctx = { root: ROOT, base: 'HEAD', updateSnapshots: false, env: process.env };
    // A wrapper that does not pass SIGTERM on to what it started, as pnpm's does not.
    const started = startChild(
      ctx,
      'sh',
      ['-c', 'sleep 30 & echo $! > "$0"; wait', pidFile],
      'ignore',
    );
    const grandchild = await pidWrittenTo(pidFile);
    expect(isRunning(grandchild)).toBe(true);
    await stopChild(started);
    expect(isRunning(grandchild)).toBe(false);
  });
});
