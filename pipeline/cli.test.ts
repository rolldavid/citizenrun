import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleTooLarge } from './bundle/sample.ts';
import type { SampleOptions } from './bundle/sample.ts';
import type { BundleRunResult } from './bundle/writer.ts';
import { commandNames, defaultCliDeps, main } from './cli.ts';
import type { BundleOptions, CliDeps } from './cli.ts';
import { loadEnv } from './env.ts';
import { repoRoot } from './lib/paths.ts';
import type { StageModule } from './lib/runner.ts';
import { loadReferenceIds } from './stages/shared/reference.ts';
import { captureLogger } from './testing/capture-log.ts';

const FIXTURE_ENV: Readonly<Record<string, string>> = {
  DATA_BUCKET: 'fixture-bucket',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture-access-id',
  DATA_SECRET_ACCESS_KEY: 'fixture-secret-value',
  S3_FORCE_PATH_STYLE: 'true',
  FEC_API_KEY: 'fixture-key',
};

let dir: string;
let printed: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pipeline-cli-'));
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    printed.push(parts.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** The repository's deps with a fixture environment, a kept log and no fetcher. */
function fixtureDeps(overrides: Partial<CliDeps> = {}) {
  const { log, lines } = captureLogger();
  const deps: CliDeps = {
    ...defaultCliDeps(),
    loadEnv: (envLog) => loadEnv(FIXTURE_ENV, envLog),
    makeLogger: () => log,
    makeFetcher: () => Promise.resolve(null),
    ...overrides,
  };
  return { deps, lines };
}

/** A stage module whose states are given and whose run must never be called. */
function stubStage(states: readonly string[]): { module: StageModule; runs: () => number } {
  let runs = 0;
  const module: StageModule = {
    id: 's02-known',
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve(states),
    run() {
      runs += 1;
      throw new Error('run is not called with --plan-out');
    },
  };
  return { module, runs: () => runs };
}

function events(lines: readonly { parsed: Record<string, unknown> }[], event: string) {
  return lines.filter((line) => line.parsed.event === event).map((line) => line.parsed);
}

describe('the command line', () => {
  it('registers exactly the listed commands', () => {
    expect([...commandNames()].sort()).toEqual(
      [
        'base',
        'known',
        'coops',
        'templates',
        'expand',
        'deadlines',
        'people',
        'bundle',
        'sample-bundle',
        'snapshots',
        'reachability',
        'fetch',
        'housekeeping',
        'home-copy',
        'datasets seed',
      ].sort(),
    );
  });

  it('--help lists every command with its options and needs no environment', async () => {
    const { deps } = fixtureDeps({
      loadEnv: () => {
        throw new Error('help reads no environment');
      },
    });
    expect(await main(['--help'], deps)).toBe(0);
    const help = printed.join('\n');
    for (const name of commandNames()) {
      expect(help).toContain(`  ${name}`);
    }
    expect(help).toContain('templates --check');
    expect(help).toContain('bundle [--kind full|geometry] [--state <ST,ST|all>] [--dry-run]');
    expect(help).toContain('--plan-out <path>');
  });

  it('--plan-out writes the states and runs nothing', async () => {
    const stub = stubStage(['NC', 'TX', 'WA']);
    const { deps } = fixtureDeps({ stages: { ...defaultCliDeps().stages, known: stub.module } });
    const out = join(dir, 'plan.json');
    expect(await main(['known', '--state', 'WA,NC', '--plan-out', out], deps)).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({ states: ['NC', 'WA'] });
    expect(stub.runs()).toBe(0);
  });

  it('--plan-out with --state all writes every state of the stage', async () => {
    const stub = stubStage(['AK', 'AL', 'US']);
    const { deps } = fixtureDeps({ stages: { ...defaultCliDeps().stages, people: stub.module } });
    const out = join(dir, 'plan.json');
    expect(await main(['people', '--state', 'all', '--plan-out', out], deps)).toBe(0);
    expect(await readFile(out, 'utf8')).toBe('{"states":["AK","AL","US"]}\n');
    expect(stub.runs()).toBe(0);
  });

  it('--plan-out does not build the fetcher', async () => {
    const stub = stubStage(['NC']);
    const { deps } = fixtureDeps({
      stages: { ...defaultCliDeps().stages, base: stub.module },
      makeFetcher: () => Promise.reject(new Error('no fetcher for a plan')),
    });
    expect(await main(['base', '--plan-out', join(dir, 'plan.json')], deps)).toBe(0);
  });

  it('a stage command refuses an unknown flag', async () => {
    const stub = stubStage(['NC']);
    const { deps } = fixtureDeps({ stages: { ...defaultCliDeps().stages, expand: stub.module } });
    expect(await main(['expand', '--kind', 'full'], deps)).toBe(2);
    expect(stub.runs()).toBe(0);
  });
});

describe('templates --check', () => {
  function checkDeps(templatesDir: string) {
    return fixtureDeps({
      templates: {
        templatesDir,
        rulesFor: () => null,
        loadReference: () => loadReferenceIds(repoRoot()),
      },
      loadEnv: () => {
        throw new Error('templates --check reads no environment');
      },
    });
  }

  it('exits 0 on an empty folder and logs no line', async () => {
    const { deps, lines } = checkDeps(dir);
    expect(await main(['templates', '--check'], deps)).toBe(0);
    expect(events(lines, 'templates.check')).toEqual([]);
  });

  it('exits 1 on an invalid template folder, one line per file', async () => {
    await writeFile(join(dir, 'nc.yaml'), 'state: NC\n');
    await writeFile(join(dir, 'zz-old.yaml'), 'state: ZZ\n');
    const { deps, lines } = checkDeps(dir);
    expect(await main(['templates', '--check'], deps)).toBe(1);
    const checks = events(lines, 'templates.check');
    expect(checks.map((line) => [line.state, line.ok])).toEqual([
      ['NC', false],
      ['zz-old', false],
    ]);
    const nc = checks[0];
    expect(nc?.errorCount).toEqual(expect.any(Number));
    expect(Number(nc?.errorCount)).toBeGreaterThan(0);
    expect(Array.isArray(nc?.paths) && nc.paths.length <= 5).toBe(true);
    expect(checks[1]?.paths).toEqual(['file']);
  });

  it('exits 0 on the repository folder, which holds valid templates or none', async () => {
    const { deps } = fixtureDeps({
      loadEnv: () => {
        throw new Error('templates --check reads no environment');
      },
    });
    expect(await main(['templates', '--check'], deps)).toBe(0);
  });

  it('takes no other option', async () => {
    const { deps } = checkDeps(dir);
    expect(await main(['templates', '--check', '--state', 'NC'], deps)).toBe(2);
    expect(await main(['bundle', '--check'], deps)).toBe(2);
    expect(await main(['templates', '--check', '--check'], deps)).toBe(2);
  });
});

describe('sample-bundle', () => {
  it('sample-bundle without --out exits 2', async () => {
    let calls = 0;
    const { deps } = fixtureDeps({
      buildSample: () => {
        calls += 1;
        return Promise.reject(new Error('not called without --out'));
      },
    });
    expect(await main(['sample-bundle'], deps)).toBe(2);
    expect(await main(['sample-bundle', '--out'], deps)).toBe(2);
    expect(await main(['sample-bundle', '--out', dir, '--state', 'NC'], deps)).toBe(2);
    expect(calls).toBe(0);
  });

  it('builds the two-state sample into --out and maps a too-large folder to 1', async () => {
    const seen: SampleOptions[] = [];
    const built = fixtureDeps({
      buildSample: (_ctx, opts) => {
        seen.push(opts);
        return Promise.resolve({
          fullVersion: 'sample-20261126T090700Z-full',
          geometryVersion: 'sample-20261126T090700Z-geometry',
          bytes: 1000,
          stateGeometryReplaced: false,
          rows: {},
          photos: 0,
        });
      },
    });
    expect(await main(['sample-bundle', '--out', dir], built.deps)).toBe(0);
    expect(seen).toEqual([
      expect.objectContaining({
        outDir: dir,
        counties: ['37063', '37135', '53067', '53045'],
        states: ['NC', 'WA'],
        maxBytes: 25_000_000,
      }),
    ]);
    expect(seen[0]?.gitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(events(built.lines, 'sample.result')).toEqual([
      expect.objectContaining({ status: 'built', fullVersion: 'sample-20261126T090700Z-full' }),
    ]);

    const large = fixtureDeps({
      buildSample: () => Promise.reject(new SampleTooLarge(25_000_001, 25_000_000)),
    });
    expect(await main(['sample-bundle', '--out', 'relative/folder'], large.deps)).toBe(1);
    expect(events(large.lines, 'sample.result')).toEqual([
      expect.objectContaining({ status: 'too_large', bytes: 25_000_001 }),
    ]);
  });
});

describe('bundle', () => {
  function bundleDeps(result: BundleRunResult) {
    const calls: BundleOptions[] = [];
    const fixture = fixtureDeps({
      runBundle: (_ctx, opts) => {
        calls.push(opts);
        return Promise.resolve(result);
      },
    });
    return { ...fixture, calls };
  }

  it('maps stopped to exit 1 and published to 0', async () => {
    const stopped = bundleDeps({
      status: 'stopped',
      reason: 'loader_missing',
      failed: [],
    });
    expect(await main(['bundle'], stopped.deps)).toBe(1);
    expect(events(stopped.lines, 'bundle.result')).toEqual([
      expect.objectContaining({ status: 'stopped', reason: 'loader_missing', kind: 'full' }),
    ]);

    const published = bundleDeps({
      status: 'published',
      fullVersion: '20261126T090700Z-full',
      geometryVersion: null,
    });
    expect(await main(['bundle', '--kind', 'full'], published.deps)).toBe(0);
    expect(events(published.lines, 'bundle.result')).toEqual([
      expect.objectContaining({ status: 'published', fullVersion: '20261126T090700Z-full' }),
    ]);
  });

  it('maps unchanged to 0 and passes the kind, the states and --dry-run', async () => {
    const unchanged = bundleDeps({ status: 'unchanged' });
    expect(
      await main(['bundle', '--kind', 'geometry', '--state', 'NC,WA', '--dry-run'], unchanged.deps),
    ).toBe(0);
    expect(unchanged.calls).toEqual([{ kind: 'geometry', dryRun: true, states: ['NC', 'WA'] }]);
  });

  it('runs every state when --state is not given', async () => {
    const run = bundleDeps({ status: 'unchanged' });
    expect(await main(['bundle'], run.deps)).toBe(0);
    expect(run.calls).toEqual([{ kind: 'full', dryRun: false, states: 'all' }]);
  });

  it('a stopped run on failed checks names them in its line', async () => {
    const run = bundleDeps({
      status: 'stopped',
      reason: 'checks_failed',
      failed: ['template_valid:ZZ'],
    });
    expect(await main(['bundle'], run.deps)).toBe(1);
    expect(events(run.lines, 'bundle.result')[0]?.failed).toEqual(['template_valid:ZZ']);
  });

  it('refuses a kind other than full or geometry', async () => {
    const run = bundleDeps({ status: 'unchanged' });
    expect(await main(['bundle', '--kind', 'filings'], run.deps)).toBe(2);
    expect(run.calls).toEqual([]);
  });
});
