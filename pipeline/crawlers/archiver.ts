// The daily snapshot archiver (PIPE-snapshot-archiver; D-327, D-084): raw copies of candidate
// lists under raw/filings/<ST>/<date>/<source>/. Nothing is parsed or read from a body, and no log
// line carries a URL, a key or a byte of content, because the lists hold personal data (INV-22).
import { IsoInstantSchema } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';
import { BucketJsonError, bucketKeys } from '../lib/bucket.ts';
import { hasMarker } from '../lib/data-files.ts';
import type { SnapshotSource } from '../lib/data-files.ts';
import { BrowserExportError } from '../lib/fetch/browser.ts';
import type { BrowserSession } from '../lib/fetch/browser.ts';
import { extForContentType } from '../lib/fetch/cache.ts';
import type { FetchResult } from '../lib/fetch/types.ts';
import { chooseListLink, listExtension } from '../lib/reachability.ts';
import type { RunContext } from '../lib/runner.ts';

// The archiver reads no fixed source: its ids are the `source` values of data/snapshot-sources.yaml.
export const SOURCE_IDS = [] as const;

export const SnapshotSidecarSchema = z.strictObject({
  url: z.string().min(1).max(2048),
  fetched_at: IsoInstantSchema,
  status: z.int(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.int().min(0),
  unchanged: z.literal(true).optional(),
});
export type SnapshotSidecar = z.infer<typeof SnapshotSidecarSchema>;

export type SnapshotOutcome = {
  source: string;
  state: string;
  result: 'saved' | 'unchanged' | 'refused' | 'disallowed' | 'challenge' | 'error' | 'skipped';
  reason: string | null;
  bytes: number | null;
};

const ELECTION_ID = '{election_id}';
const SNAPSHOT_EXTENSIONS: ReadonlySet<string> = new Set(['csv', 'xlsx', 'html', 'txt']);
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html',
  txt: 'text/plain',
};
const BODY_NAME = /^\d{6}Z(?:-(\d{1,10}))?\.([a-z0-9]{1,10})$/;

/** True when the entry runs today: `always`, or a window with from <= today <= to. */
export function isDue(entry: SnapshotSource, today: string): boolean {
  if (entry.always) {
    return true;
  }
  return (entry.windows ?? []).some((window) => window.from <= today && today <= window.to);
}

/** 0 when no entry ended `error`; a refused, disallowed or challenged entry is an outcome, not a failure. */
export function snapshotsExitCode(outcomes: readonly SnapshotOutcome[]): 0 | 1 {
  return outcomes.some((outcome) => outcome.result === 'error') ? 1 : 0;
}

/** One `snapshot.done` line: never a URL, a key or content. */
export function logSnapshotOutcome(log: Logger, outcome: SnapshotOutcome): void {
  log.info('snapshot.done', {
    source: outcome.source,
    state: outcome.state,
    result: outcome.result,
    reason: outcome.reason,
    bytes: outcome.bytes,
  });
}

function hhmmssOf(now: Date): string {
  return now.toISOString().slice(11, 19).replaceAll(':', '');
}

/** csv, xlsx, html or txt from a content type, else bin. */
function extForSnapshot(contentType: string | null): string {
  const ext = extForContentType(contentType);
  return SNAPSHOT_EXTENSIONS.has(ext) ? ext : 'bin';
}

/** csv, xlsx, html or txt from a file name, else bin. */
function extForName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  if (ext === 'htm') {
    return 'html';
  }
  return SNAPSHOT_EXTENSIONS.has(ext) ? ext : 'bin';
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function fromFetchResult(
  source: string,
  state: string,
  result: Exclude<FetchResult, { kind: 'ok' }>,
): SnapshotOutcome {
  const base = { source, state, bytes: null };
  switch (result.kind) {
    case 'not_modified':
      return { ...base, result: 'error', reason: 'not_modified' };
    case 'disallowed':
      return { ...base, result: 'disallowed', reason: result.reason };
    case 'challenge':
      return { ...base, result: 'challenge', reason: `http_${String(result.status)}` };
    case 'error':
      return { ...base, result: 'error', reason: result.reason };
  }
}

/**
 * The sidecar of this source's previous stored body: the greatest key under the state's prefix
 * whose source folder is `source`, with the same part (or none) and extension, other than `current`.
 */
async function previousSidecar(
  ctx: RunContext,
  opts: { state: string; source: string; part: string | null; ext: string; current: string },
): Promise<SnapshotSidecar | null> {
  let best: string | null = null;
  for await (const info of ctx.bucket.list(bucketKeys.rawFilingsPrefix(opts.state))) {
    const segments = info.key.split('/');
    if (segments.length !== 6 || segments[4] !== opts.source || info.key === opts.current) {
      continue;
    }
    const match = BODY_NAME.exec(segments[5] ?? '');
    if (match === null || match[2] === 'json' || match[2] !== opts.ext) {
      continue;
    }
    if ((match[1] ?? null) !== opts.part) {
      continue;
    }
    if (best === null || byteOrder(info.key, best) > 0) {
      best = info.key;
    }
  }
  if (best === null) {
    return null;
  }
  try {
    return await ctx.bucket.getJson(best.replace(/\.[a-z0-9]+$/, '.json'), SnapshotSidecarSchema);
  } catch (error) {
    if (error instanceof BucketJsonError) {
      return null;
    }
    throw error;
  }
}

type Stored = {
  source: string;
  state: string;
  url: string;
  part: string | null;
  ext: string;
  key: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  sha256: string;
  bytes: number;
};

/** The unchanged rule and the sidecar, once the body is at `key`. */
async function finishSnapshot(ctx: RunContext, stored: Stored): Promise<SnapshotOutcome> {
  const hhmmss = hhmmssOf(ctx.now);
  const previous = await previousSidecar(ctx, {
    state: stored.state,
    source: stored.source,
    part: stored.part,
    ext: stored.ext,
    current: stored.key,
  });
  const unchanged = previous !== null && previous.sha256 === stored.sha256;
  if (unchanged) {
    await ctx.bucket.delete([stored.key]);
  }
  await ctx.bucket.putJson(
    bucketKeys.rawFilingsSidecar(
      stored.state,
      ctx.today,
      stored.source,
      hhmmss,
      stored.part ?? undefined,
    ),
    {
      url: stored.url,
      fetched_at: ctx.now.toISOString(),
      status: stored.status,
      etag: stored.etag,
      last_modified: stored.lastModified,
      sha256: stored.sha256,
      bytes: stored.bytes,
      ...(unchanged ? { unchanged: true as const } : {}),
    },
    SnapshotSidecarSchema,
  );
  return {
    source: stored.source,
    state: stored.state,
    result: unchanged ? 'unchanged' : 'saved',
    reason: null,
    bytes: stored.bytes,
  };
}

/**
 * Downloads one list straight into its raw/filings key (never through `fetch()`, which would copy
 * it into cache/raw/), then applies the sidecar and unchanged rules.
 */
export async function storeSnapshot(
  ctx: RunContext,
  opts: { source: string; state: string; url: string; part: string | null },
): Promise<SnapshotOutcome> {
  const hhmmss = hhmmssOf(ctx.now);
  const part = opts.part ?? undefined;
  let ext = listExtension(opts.url);
  let key = bucketKeys.rawFilings(opts.state, ctx.today, opts.source, hhmmss, ext, part);
  const result = await ctx.fetcher.download(
    { url: opts.url, class: 'adapter', state: opts.state, purpose: `snapshot:${opts.source}` },
    key,
  );
  if (result.kind !== 'ok') {
    return fromFetchResult(opts.source, opts.state, result);
  }
  // The URL named no extension: the content type names it, and the body moves to that key.
  const typed = ext === 'bin' ? extForSnapshot(result.contentType) : ext;
  if (typed !== ext) {
    const body = await ctx.bucket.getBytes(key);
    const moved = bucketKeys.rawFilings(opts.state, ctx.today, opts.source, hhmmss, typed, part);
    if (body !== null) {
      await ctx.bucket.putBytes(moved, body, CONTENT_TYPES[typed] ?? 'application/octet-stream');
      await ctx.bucket.delete([key]);
    }
    ext = typed;
    key = moved;
  }
  return finishSnapshot(ctx, {
    source: opts.source,
    state: opts.state,
    url: opts.url,
    part: opts.part,
    ext,
    key,
    status: result.status,
    etag: result.etag,
    lastModified: result.lastModified,
    sha256: result.sha256,
    bytes: result.bytes,
  });
}

/** Stores one browser export's bytes at its raw/filings key. */
async function storeExport(
  ctx: RunContext,
  opts: { source: string; state: string; url: string; part: string | null },
  session: BrowserSession,
  buttonText: string,
): Promise<SnapshotOutcome> {
  let exported;
  try {
    exported = await session.exportDownload({
      pageUrl: opts.url,
      buttonText,
      state: opts.state,
    });
  } catch (error) {
    return fromBrowserError(opts.source, opts.state, error);
  }
  const ext = extForName(exported.suggestedName);
  const key = bucketKeys.rawFilings(
    opts.state,
    ctx.today,
    opts.source,
    hhmmssOf(ctx.now),
    ext,
    opts.part ?? undefined,
  );
  const written = await ctx.bucket.putBytes(
    key,
    exported.bytes,
    CONTENT_TYPES[ext] ?? 'application/octet-stream',
  );
  return finishSnapshot(ctx, {
    ...opts,
    ext,
    key,
    status: exported.status,
    etag: null,
    lastModified: null,
    sha256: written.sha256,
    bytes: written.bytes,
  });
}

function fromBrowserError(source: string, state: string, error: unknown): SnapshotOutcome {
  if (error instanceof BrowserExportError) {
    return { source, state, result: error.result, reason: error.reason, bytes: null };
  }
  // A browser failure's message can hold a URL, so only its kind is recorded.
  return { source, state, result: 'error', reason: 'browser', bytes: null };
}

async function runEntry(
  ctx: RunContext,
  entry: SnapshotSource,
  includeBlocked: boolean,
  browser: () => Promise<BrowserSession>,
): Promise<readonly SnapshotOutcome[]> {
  const { source, state, recipe } = entry;
  const base = { source, state, bytes: null };
  if (entry.blocked === true && !includeBlocked) {
    return [{ ...base, result: 'skipped', reason: 'blocked' }];
  }
  if (hasMarker(entry)) {
    return [{ ...base, result: 'refused', reason: 'marker' }];
  }
  switch (recipe.kind) {
    case 'get':
      return [await storeSnapshot(ctx, { source, state, url: recipe.url, part: null })];
    case 'discover_get': {
      const page = await ctx.fetcher.fetch({ url: recipe.page, class: 'adapter', state });
      if (page.kind !== 'ok') {
        return [fromFetchResult(source, state, page)];
      }
      const html = await ctx.bucket.getBytes(page.cacheKey);
      const link =
        html === null
          ? null
          : chooseListLink(Buffer.from(html).toString('utf8'), page.finalUrl, recipe.link_pattern);
      if (link === null) {
        return [{ ...base, result: 'error', reason: 'no_link' }];
      }
      return [await storeSnapshot(ctx, { source, state, url: link, part: null })];
    }
    case 'playwright_export': {
      let session: BrowserSession;
      try {
        session = await browser();
      } catch {
        return [{ ...base, result: 'error', reason: 'browser' }];
      }
      if (!recipe.url.includes(ELECTION_ID)) {
        return [
          await storeExport(
            ctx,
            { source, state, url: recipe.url, part: null },
            session,
            recipe.export_button_text,
          ),
        ];
      }
      let ids: readonly number[];
      try {
        ids = await session.readElectionIds(
          recipe.election_ids_from ?? recipe.url,
          state,
          recipe.election_select ?? null,
        );
      } catch (error) {
        return [fromBrowserError(source, state, error)];
      }
      if (ids.length === 0) {
        return [{ ...base, result: 'skipped', reason: 'no_elections' }];
      }
      const outcomes: SnapshotOutcome[] = [];
      for (const id of ids) {
        const part = String(id);
        outcomes.push(
          await storeExport(
            ctx,
            { source, state, url: recipe.url.replaceAll(ELECTION_ID, part), part },
            session,
            recipe.export_button_text,
          ),
        );
      }
      return outcomes;
    }
  }
}

/**
 * Runs every due entry of `entries`, in file order. `browser` is called at most once, on the first
 * playwright_export entry; the caller closes the session it opened.
 */
export async function runSnapshots(
  ctx: RunContext,
  entries: readonly SnapshotSource[],
  opts: {
    includeBlocked: boolean;
    states: readonly string[] | 'all';
    browser: () => Promise<BrowserSession>;
  },
): Promise<readonly SnapshotOutcome[]> {
  let opened: Promise<BrowserSession> | null = null;
  const browser = (): Promise<BrowserSession> => {
    opened ??= opts.browser();
    return opened;
  };
  const outcomes: SnapshotOutcome[] = [];
  for (const entry of entries) {
    if (opts.states !== 'all' && !opts.states.includes(entry.state)) {
      continue;
    }
    if (!isDue(entry, ctx.today)) {
      continue;
    }
    let results: readonly SnapshotOutcome[];
    try {
      results = await runEntry(ctx, entry, opts.includeBlocked, browser);
    } catch {
      // One entry's failure never stops the others; its message is not logged (it can hold a URL).
      results = [
        {
          source: entry.source,
          state: entry.state,
          result: 'error',
          reason: 'exception',
          bytes: null,
        },
      ];
    }
    for (const outcome of results) {
      logSnapshotOutcome(ctx.log, outcome);
      outcomes.push(outcome);
    }
  }
  return outcomes;
}
