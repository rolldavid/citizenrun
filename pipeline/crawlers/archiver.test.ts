import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PipelineEnv } from '../env.ts';
import { bucketKeys } from '../lib/bucket.ts';
import type { SnapshotSource } from '../lib/data-files.ts';
import type { BrowserSession } from '../lib/fetch/browser.ts';
import { BrowserExportError } from '../lib/fetch/browser.ts';
import { storeRawBody } from '../lib/fetch/cache.ts';
import type { FetchRequest, FetchResult, Fetcher } from '../lib/fetch/types.ts';
import { runLocalFetch } from '../lib/local-fetch.ts';
import { createRunContext } from '../lib/runner.ts';
import type { RunContext } from '../lib/runner.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import type { MemoryBucket } from '../testing/memory-bucket.ts';
import { SnapshotSidecarSchema, isDue, runSnapshots, snapshotsExitCode } from './archiver.ts';
import type { SnapshotOutcome } from './archiver.ts';

const ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'fixture',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture',
  DATA_SECRET_ACCESS_KEY: 'fixture',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'debug',
  PIPELINE_RUN_ID: null,
  FEC_API_KEY: null,
  isCi: false,
});

const LIST_HOST = 'lists.example.test';
const LIST_URL = `https://${LIST_HOST}/Candidate_Listing_2026.csv`;
const LIST_BODY = 'county,contest,name\nFixture County,Fixture Office,Fixture Person\n';

type Script =
  | { kind: 'body'; status: number; contentType: string; body: string; etag?: string }
  | Exclude<FetchResult, { kind: 'ok' }>;

/** A fetcher that answers from a script, storing bodies where the real one would. */
class ScriptedFetcher implements Fetcher {
  readonly requests: { method: 'fetch' | 'download'; req: FetchRequest; key: string | null }[] = [];
  readonly #bucket: MemoryBucket;
  readonly #script: (url: string) => Script;

  constructor(bucket: MemoryBucket, script: (url: string) => Script) {
    this.#bucket = bucket;
    this.#script = script;
  }

  async fetch(req: FetchRequest): Promise<FetchResult> {
    this.requests.push({ method: 'fetch', req, key: null });
    const script = this.#script(req.url);
    if (script.kind !== 'body') {
      return script;
    }
    const bytes = new TextEncoder().encode(script.body);
    const stored = await storeRawBody(this.#bucket, bytes, script.contentType);
    return {
      kind: 'ok',
      finalUrl: req.url,
      status: script.status,
      contentType: script.contentType,
      etag: script.etag ?? null,
      lastModified: null,
      sha256: stored.sha256,
      bytes: bytes.byteLength,
      cacheKey: stored.key,
    };
  }

  async download(req: FetchRequest, key: string): Promise<FetchResult> {
    this.requests.push({ method: 'download', req, key });
    const script = this.#script(req.url);
    if (script.kind !== 'body') {
      return script;
    }
    const written = await this.#bucket.putBytes(
      key,
      new TextEncoder().encode(script.body),
      script.contentType,
    );
    return {
      kind: 'ok',
      finalUrl: req.url,
      status: script.status,
      contentType: script.contentType,
      etag: script.etag ?? null,
      lastModified: null,
      sha256: written.sha256,
      bytes: written.bytes,
      cacheKey: key,
    };
  }
}

function csv(body: string = LIST_BODY, etag?: string): Script {
  return {
    kind: 'body',
    status: 200,
    contentType: 'text/csv',
    body,
    ...(etag === undefined ? {} : { etag }),
  };
}

function setup(opts: { now: string; script?: (url: string) => Script }) {
  const bucket = createMemoryBucket();
  const fetcher = new ScriptedFetcher(bucket, opts.script ?? (() => csv()));
  const { log, lines } = captureLogger();
  const ctx: RunContext = createRunContext({
    env: ENV,
    now: new Date(opts.now),
    bucket,
    fetcher,
    log,
  });
  return { bucket, fetcher, ctx, lines };
}

const NO_BROWSER = (): Promise<BrowserSession> => Promise.reject(new Error('not opened'));

function getEntry(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    source: 'nc-sbe',
    state: 'NC',
    always: true,
    recipe: { kind: 'get', url: LIST_URL },
    ...overrides,
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function run(
  ctx: RunContext,
  entries: readonly SnapshotSource[],
  opts: { includeBlocked?: boolean; browser?: () => Promise<BrowserSession> } = {},
): Promise<readonly SnapshotOutcome[]> {
  return runSnapshots(ctx, entries, {
    includeBlocked: opts.includeBlocked ?? false,
    states: 'all',
    browser: opts.browser ?? NO_BROWSER,
  });
}

/** A browser session that records what it is asked and exports `body(pageUrl)`. */
function fakeSession(body: (pageUrl: string) => string, ids: readonly number[] = []) {
  const calls = { readElectionIds: [] as string[], exportDownload: [] as string[], closed: 0 };
  const session: BrowserSession = {
    readElectionIds(pageUrl) {
      calls.readElectionIds.push(pageUrl);
      return Promise.resolve(ids);
    },
    exportDownload({ pageUrl }) {
      calls.exportDownload.push(pageUrl);
      return Promise.resolve({
        bytes: new TextEncoder().encode(body(pageUrl)),
        suggestedName: 'CandidateList.csv',
        finalUrl: pageUrl,
        status: 200,
      });
    },
    close() {
      calls.closed += 1;
      return Promise.resolve();
    },
  };
  return { session, calls };
}

async function seedPrevious(
  bucket: MemoryBucket,
  key: string,
  sidecarKey: string,
  body: string,
): Promise<void> {
  await bucket.putBytes(key, new TextEncoder().encode(body), 'text/csv');
  await bucket.putJson(
    sidecarKey,
    {
      url: LIST_URL,
      fetched_at: '2026-11-15T05:53:12.000Z',
      status: 200,
      etag: null,
      last_modified: null,
      sha256: sha256(body),
      bytes: Buffer.byteLength(body),
    },
    SnapshotSidecarSchema,
  );
}

describe('isDue', () => {
  it('always, or inside a window with both ends included', () => {
    const windowed = getEntry({
      always: false,
      windows: [{ from: '2027-01-13', to: '2027-02-12' }],
    });
    expect(isDue(getEntry(), '2026-01-01')).toBe(true);
    expect(isDue(windowed, '2027-01-12')).toBe(false);
    expect(isDue(windowed, '2027-01-13')).toBe(true);
    expect(isDue(windowed, '2027-02-12')).toBe(true);
    expect(isDue(windowed, '2027-02-13')).toBe(false);
  });
});

describe('runSnapshots', () => {
  it('an entry with a marker is refused and nothing is requested', async () => {
    const { ctx, fetcher, bucket } = setup({ now: '2026-11-16T05:53:12.000Z' });
    const outcomes = await run(ctx, [
      getEntry({ recipe: { kind: 'get', url: '<recorded at build>' } }),
      getEntry({
        source: 'tx-sos',
        state: 'TX',
        recipe: {
          kind: 'playwright_export',
          url: 'https://app.example.test/candidates',
          export_button_text: '<recorded at build>',
        },
      }),
    ]);
    expect(outcomes.map((outcome) => [outcome.result, outcome.reason])).toEqual([
      ['refused', 'marker'],
      ['refused', 'marker'],
    ]);
    expect(fetcher.requests).toEqual([]);
    expect(bucket.keys()).toEqual([]);
    expect(snapshotsExitCode(outcomes)).toBe(0);
  });

  it('an unchanged body writes only the sidecar', async () => {
    const { ctx, bucket } = setup({ now: '2026-11-16T05:53:12.000Z' });
    await seedPrevious(
      bucket,
      'raw/filings/NC/2026-11-15/nc-sbe/055312Z.csv',
      'raw/filings/NC/2026-11-15/nc-sbe/055312Z.json',
      LIST_BODY,
    );
    const outcomes = await run(ctx, [getEntry()]);
    expect(outcomes).toEqual([
      { source: 'nc-sbe', state: 'NC', result: 'unchanged', reason: null, bytes: 65 },
    ]);
    expect(bucket.keys()).not.toContain('raw/filings/NC/2026-11-16/nc-sbe/055312Z.csv');
    const sidecar = await bucket.getJson(
      'raw/filings/NC/2026-11-16/nc-sbe/055312Z.json',
      SnapshotSidecarSchema,
    );
    expect(sidecar).toMatchObject({ unchanged: true, sha256: sha256(LIST_BODY), url: LIST_URL });
  });

  it('a changed body is stored under raw/filings/<ST>/<today>/<source>/<HHMMSS>Z.<ext> with its sidecar', async () => {
    const { ctx, bucket } = setup({
      now: '2026-11-16T05:53:12.000Z',
      script: () => csv(LIST_BODY, '"v2"'),
    });
    await seedPrevious(
      bucket,
      'raw/filings/NC/2026-11-15/nc-sbe/055312Z.csv',
      'raw/filings/NC/2026-11-15/nc-sbe/055312Z.json',
      'county,contest,name\n',
    );
    const outcomes = await run(ctx, [getEntry()]);
    expect(outcomes.map((outcome) => outcome.result)).toEqual(['saved']);
    const body = await bucket.getBytes('raw/filings/NC/2026-11-16/nc-sbe/055312Z.csv');
    expect(Buffer.from(body ?? new Uint8Array()).toString('utf8')).toBe(LIST_BODY);
    const sidecar = await bucket.getJson(
      'raw/filings/NC/2026-11-16/nc-sbe/055312Z.json',
      SnapshotSidecarSchema,
    );
    expect(sidecar).toEqual({
      url: LIST_URL,
      fetched_at: '2026-11-16T05:53:12.000Z',
      status: 200,
      etag: '"v2"',
      last_modified: null,
      sha256: sha256(LIST_BODY),
      bytes: 65,
    });
  });

  it('a list whose URL names no extension takes it from the content type', async () => {
    const { ctx, bucket } = setup({
      now: '2026-11-16T05:53:12.000Z',
      script: () => ({ kind: 'body', status: 200, contentType: 'text/html', body: '<p>x</p>' }),
    });
    await run(ctx, [
      getEntry({
        source: 'va-elections',
        state: 'VA',
        recipe: { kind: 'get', url: `https://${LIST_HOST}/list/` },
      }),
    ]);
    expect(bucket.keys()).toEqual([
      'raw/filings/VA/2026-11-16/va-elections/055312Z.html',
      'raw/filings/VA/2026-11-16/va-elections/055312Z.json',
    ]);
  });

  it('window entries run only inside their window', async () => {
    const entry = getEntry({
      source: 'tx-2027-05-01',
      state: 'TX',
      always: false,
      windows: [{ from: '2027-01-13', to: '2027-02-12' }],
    });
    const results: Record<string, number> = {};
    for (const day of ['2027-01-12', '2027-01-13', '2027-02-12', '2027-02-13']) {
      const { ctx, fetcher } = setup({ now: `${day}T05:53:12.000Z` });
      const outcomes = await run(ctx, [entry]);
      results[day] = fetcher.requests.length;
      expect(outcomes.length).toBe(fetcher.requests.length);
    }
    expect(results).toEqual({
      '2027-01-12': 0,
      '2027-01-13': 1,
      '2027-02-12': 1,
      '2027-02-13': 0,
    });
  });

  it('blocked entries are skipped by the daily run and taken by the local fetch', async () => {
    const blocked = getEntry({ source: 'ga-sos', state: 'GA', blocked: true });
    const daily = setup({ now: '2026-11-16T05:53:12.000Z' });
    const skipped = await run(daily.ctx, [blocked]);
    expect(skipped).toEqual([
      { source: 'ga-sos', state: 'GA', result: 'skipped', reason: 'blocked', bytes: null },
    ]);
    expect(daily.fetcher.requests).toEqual([]);

    const local = setup({ now: '2026-11-16T05:53:12.000Z' });
    const outcome = await runLocalFetch(local.ctx, {
      state: null,
      snapshots: [blocked, getEntry()],
      browser: NO_BROWSER,
    });
    expect(outcome.exitCode).toBe(0);
    // Only the blocked entry is taken; the daily run owns the other.
    expect(local.fetcher.requests.map((request) => request.req.purpose)).toEqual([
      'snapshot:ga-sos',
    ]);
    expect(local.bucket.keys()).toContain('raw/filings/GA/2026-11-16/ga-sos/055312Z.csv');
  });

  it("discover_get picks the newest year's file", async () => {
    const page = 'https://www.example.test/results-data/candidate-lists';
    const { ctx, fetcher, bucket } = setup({
      now: '2026-11-16T05:53:12.000Z',
      script: (url) =>
        url === page
          ? {
              kind: 'body',
              status: 200,
              contentType: 'text/html',
              body: '<a href="/files/Candidate_Listing_2025.csv">2025</a><a href="/files/Candidate_Listing_2026.csv">2026</a><a href="/files/other.csv">x</a>',
            }
          : csv(),
    });
    const outcomes = await run(ctx, [
      getEntry({
        recipe: { kind: 'discover_get', page, link_pattern: 'Candidate_Listing_\\d{4}\\.csv$' },
      }),
    ]);
    expect(outcomes.map((outcome) => outcome.result)).toEqual(['saved']);
    expect(fetcher.requests.map((request) => [request.method, request.req.url])).toEqual([
      ['fetch', page],
      ['download', 'https://www.example.test/files/Candidate_Listing_2026.csv'],
    ]);
    expect(bucket.keys()).toContain('raw/filings/NC/2026-11-16/nc-sbe/055312Z.csv');
  });

  it('a list never reaches cache/raw', async () => {
    const page = 'https://www.example.test/lists';
    const pageHtml = '<a href="/files/Candidate_Listing_2026.csv">list</a>';
    const { ctx, bucket } = setup({
      now: '2026-11-16T05:53:12.000Z',
      script: (url) =>
        url === page
          ? { kind: 'body', status: 200, contentType: 'text/html', body: pageHtml }
          : csv(),
    });
    await run(ctx, [
      getEntry({ source: 'va-elections', state: 'VA' }),
      getEntry({
        recipe: { kind: 'discover_get', page, link_pattern: 'Candidate_Listing_\\d{4}\\.csv$' },
      }),
    ]);
    const cached = bucket.keys().filter((key) => key.startsWith(bucketKeys.rawCachePrefix()));
    expect(cached).toEqual([bucketKeys.rawCache(sha256(pageHtml), 'html')]);
  });

  it('the log carries no URL, key or content', async () => {
    const { ctx, lines } = setup({ now: '2026-11-16T05:53:12.000Z' });
    await run(ctx, [
      getEntry(),
      getEntry({ source: 'ga-sos', state: 'GA', blocked: true }),
      getEntry({
        source: 'va-elections',
        state: 'VA',
        recipe: { kind: 'get', url: '<recorded at build>' },
      }),
    ]);
    const done = lines.filter((line) => line.parsed.event === 'snapshot.done');
    expect(done).toHaveLength(3);
    for (const line of lines) {
      expect(line.raw).not.toContain('https://');
      expect(line.raw).not.toContain(LIST_HOST);
      expect(line.raw).not.toContain('raw/filings');
      expect(line.raw).not.toContain('055312Z');
      expect(line.raw).not.toContain('Fixture');
    }
    expect(done[0]?.parsed).toMatchObject({
      source: 'nc-sbe',
      state: 'NC',
      result: 'saved',
      reason: null,
      bytes: 65,
    });
  });

  it('a refused robots path is recorded, not failed', async () => {
    const { ctx, bucket } = setup({
      now: '2026-11-16T05:53:12.000Z',
      script: () => ({ kind: 'disallowed', reason: 'robots' }),
    });
    const outcomes = await run(ctx, [getEntry()]);
    expect(outcomes).toEqual([
      { source: 'nc-sbe', state: 'NC', result: 'disallowed', reason: 'robots', bytes: null },
    ]);
    expect(snapshotsExitCode(outcomes)).toBe(0);
    expect(bucket.keys()).toEqual([]);
  });

  it('an error fails the run and does not stop the next entry', async () => {
    const { ctx } = setup({
      now: '2026-11-16T05:53:12.000Z',
      script: (url) =>
        url === LIST_URL ? { kind: 'error', status: 500, reason: 'http_status' } : csv(),
    });
    const outcomes = await run(ctx, [
      getEntry(),
      getEntry({
        source: 'va-elections',
        state: 'VA',
        recipe: { kind: 'get', url: `https://${LIST_HOST}/va.csv` },
      }),
    ]);
    expect(outcomes.map((outcome) => [outcome.result, outcome.reason])).toEqual([
      ['error', 'http_status'],
      ['saved', null],
    ]);
    expect(snapshotsExitCode(outcomes)).toBe(1);
  });

  it('a playwright_export entry uses the session it is given', async () => {
    const { ctx, bucket, fetcher } = setup({ now: '2026-11-16T05:30:12.000Z' });
    const { session, calls } = fakeSession(() => LIST_BODY);
    let asked = 0;
    const browser = (): Promise<BrowserSession> => {
      asked += 1;
      return Promise.resolve(session);
    };
    const exportEntry = (source: string, url: string): SnapshotSource => ({
      source,
      state: 'LA',
      always: true,
      recipe: { kind: 'playwright_export', url, export_button_text: 'Export to CSV' },
    });
    const outcomes = await run(
      ctx,
      [
        exportEntry('la-sos', 'https://portal.example.test/a'),
        exportEntry('la-other', 'https://portal.example.test/b'),
      ],
      { browser },
    );
    expect(asked).toBe(1);
    expect(calls.exportDownload).toEqual([
      'https://portal.example.test/a',
      'https://portal.example.test/b',
    ]);
    // The caller closes the session it opened.
    expect(calls.closed).toBe(0);
    expect(outcomes.map((outcome) => outcome.result)).toEqual(['saved', 'saved']);
    expect(fetcher.requests).toEqual([]);
    expect(bucket.keys()).toContain('raw/filings/LA/2026-11-16/la-sos/053012Z.csv');
  });

  it('a browser refusal is recorded with its reason', async () => {
    const { ctx } = setup({ now: '2026-11-16T05:30:12.000Z' });
    const session: BrowserSession = {
      readElectionIds: () => Promise.resolve([]),
      exportDownload: () => Promise.reject(new BrowserExportError('disallowed', 'robots')),
      close: () => Promise.resolve(),
    };
    const outcomes = await run(
      ctx,
      [
        {
          source: 'la-sos',
          state: 'LA',
          always: true,
          recipe: {
            kind: 'playwright_export',
            url: 'https://portal.example.test/a',
            export_button_text: 'Export to CSV',
          },
        },
      ],
      { browser: () => Promise.resolve(session) },
    );
    expect(outcomes).toEqual([
      { source: 'la-sos', state: 'LA', result: 'disallowed', reason: 'robots', bytes: null },
    ]);
  });

  it('two election ids give two lists and two sidecars', async () => {
    const { ctx, bucket } = setup({ now: '2026-11-16T05:30:12.000Z' });
    const body894 = 'list,894\nFixture Person,Fixture Office\n';
    const body901 = 'list,901\nFixture Person,Fixture Office\n';
    const { session, calls } = fakeSession(
      (pageUrl) => (pageUrl.endsWith('=894') ? body894 : body901),
      [894, 901],
    );
    await seedPrevious(
      bucket,
      'raw/filings/WA/2026-11-15/wa-sos/053012Z-894.csv',
      'raw/filings/WA/2026-11-15/wa-sos/053012Z-894.json',
      body894,
    );
    const outcomes = await run(
      ctx,
      [
        {
          source: 'wa-sos',
          state: 'WA',
          always: true,
          recipe: {
            kind: 'playwright_export',
            url: 'https://voter.example.test/CandidateList.aspx?e={election_id}',
            election_ids_from: 'https://voter.example.test/CandidateList.aspx',
            export_button_text: 'Export to CSV',
          },
        },
      ],
      { browser: () => Promise.resolve(session) },
    );
    expect(calls.readElectionIds).toEqual(['https://voter.example.test/CandidateList.aspx']);
    expect(calls.exportDownload).toEqual([
      'https://voter.example.test/CandidateList.aspx?e=894',
      'https://voter.example.test/CandidateList.aspx?e=901',
    ]);
    expect(outcomes.map((outcome) => outcome.result)).toEqual(['unchanged', 'saved']);
    const today = bucket.keys().filter((key) => key.startsWith('raw/filings/WA/2026-11-16/'));
    expect(today).toEqual([
      'raw/filings/WA/2026-11-16/wa-sos/053012Z-894.json',
      'raw/filings/WA/2026-11-16/wa-sos/053012Z-901.csv',
      'raw/filings/WA/2026-11-16/wa-sos/053012Z-901.json',
    ]);
    const sidecar894 = await bucket.getJson(
      'raw/filings/WA/2026-11-16/wa-sos/053012Z-894.json',
      SnapshotSidecarSchema,
    );
    const sidecar901 = await bucket.getJson(
      'raw/filings/WA/2026-11-16/wa-sos/053012Z-901.json',
      SnapshotSidecarSchema,
    );
    expect(sidecar894?.unchanged).toBe(true);
    expect(sidecar901?.unchanged).toBeUndefined();
    expect(sidecar901?.url).toBe('https://voter.example.test/CandidateList.aspx?e=901');
  });

  it('a state filter keeps other states out', async () => {
    const { ctx, fetcher } = setup({ now: '2026-11-16T05:53:12.000Z' });
    const outcomes = await runSnapshots(
      ctx,
      [getEntry(), getEntry({ source: 'va-elections', state: 'VA' })],
      {
        includeBlocked: false,
        states: ['VA'],
        browser: NO_BROWSER,
      },
    );
    expect(outcomes.map((outcome) => outcome.source)).toEqual(['va-elections']);
    expect(fetcher.requests).toHaveLength(1);
  });
});
