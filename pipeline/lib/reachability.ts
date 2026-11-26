// D-100 spike 14: robots.txt and candidate-list reachability per pilot source (PIPE-reachability).
// No body content enters the report. A list goes only to raw/filings/, never to the raw cache.
import { load } from 'cheerio';
import { IsoInstantSchema } from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeys } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import type { PipelineFetcher } from './fetch/fetcher.ts';
import type { FetchResult } from './fetch/types.ts';
import { productToken } from './fetch/user-agent.ts';

export type ReachabilityTarget = {
  state: string;
  source: string;
  kind: 'get' | 'discover_get' | 'playwright_export';
  url: string;
  linkPattern: string | null;
};

const ResultRowSchema = z.strictObject({
  state: z.string(),
  source: z.string(),
  kind: z.string(),
  target: z.string(),
  host: z.string(),
  robots_status: z.int().nullable(),
  robots: z.enum(['allowed', 'disallowed', 'absent', 'unavailable', 'challenge']),
  result: z.enum(['ok', 'not_modified', 'disallowed', 'challenge', 'error']),
  status: z.int().nullable(),
  challenge: z.boolean(),
  etag_present: z.boolean(),
  last_modified_present: z.boolean(),
  discovered: z.string().nullable(),
});
type ResultRow = z.infer<typeof ResultRowSchema>;

export const ReachabilityReportSchema = z.strictObject({
  generated_at: IsoInstantSchema,
  from: z.enum(['owner_machine', 'github_runner']),
  product_token: z.string(),
  results: z.array(ResultRowSchema),
});
export type ReachabilityReport = z.infer<typeof ReachabilityReportSchema>;

/** The sidecar written beside a saved list (PIPE-snapshot-archiver). */
const ListSidecarSchema = z.strictObject({
  url: z.string(),
  fetched_at: IsoInstantSchema,
  status: z.int(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.int().min(0),
});

const SNAPSHOT_EXTENSIONS: ReadonlySet<string> = new Set(['csv', 'xlsx', 'html', 'txt']);

/**
 * The extension of a saved list, from the name its URL gives it (the download's suggested name):
 * `csv`, `xlsx`, `html` or `txt`, else `bin`. The key is chosen before the response arrives.
 */
export function listExtension(url: string): string {
  let name: string;
  try {
    name = new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return 'bin';
  }
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  if (ext === 'htm') {
    return 'html';
  }
  return SNAPSHOT_EXTENSIONS.has(ext) ? ext : 'bin';
}

/** Every `a[href]` of the page resolved against `pageUrl` and matching `pattern`; the greatest. */
export function chooseListLink(html: string, pageUrl: string, pattern: string): string | null {
  const matcher = new RegExp(pattern, 'u');
  const $ = load(html);
  let best: string | null = null;
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href');
    if (href === undefined) {
      return;
    }
    let resolved: string;
    try {
      resolved = new URL(href, pageUrl).href;
    } catch {
      return;
    }
    if (!matcher.test(resolved)) {
      return;
    }
    if (best === null || Buffer.compare(Buffer.from(resolved), Buffer.from(best)) > 0) {
      best = resolved;
    }
  });
  return best;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function fromResult(
  result: FetchResult,
): Pick<ResultRow, 'result' | 'status' | 'challenge' | 'etag_present' | 'last_modified_present'> {
  switch (result.kind) {
    case 'ok':
      return {
        result: 'ok',
        status: result.status,
        challenge: false,
        etag_present: result.etag !== null,
        last_modified_present: result.lastModified !== null,
      };
    case 'not_modified':
      return {
        result: 'not_modified',
        status: 304,
        challenge: false,
        etag_present: false,
        last_modified_present: false,
      };
    case 'disallowed':
      return {
        result: 'disallowed',
        status: null,
        challenge: false,
        etag_present: false,
        last_modified_present: false,
      };
    case 'challenge':
      return {
        result: 'challenge',
        status: result.status,
        challenge: true,
        etag_present: false,
        last_modified_present: false,
      };
    case 'error':
      return {
        result: 'error',
        status: result.status,
        challenge: false,
        etag_present: false,
        last_modified_present: false,
      };
  }
}

const NOTHING_SENT = {
  status: null,
  challenge: false,
  etag_present: false,
  last_modified_present: false,
} as const;

/** Downloads a list into its raw/filings key and writes the sidecar beside it. */
async function saveList(
  fetcher: PipelineFetcher,
  bucket: DataBucket,
  target: ReachabilityTarget,
  url: string,
  nowIso: string,
): Promise<FetchResult> {
  const date = nowIso.slice(0, 10);
  const hhmmss = nowIso.slice(11, 19).replaceAll(':', '');
  const key = bucketKeys.rawFilings(target.state, date, target.source, hhmmss, listExtension(url));
  const result = await fetcher.download(
    { url, class: 'adapter', state: target.state, purpose: `snapshot:${target.source}` },
    key,
  );
  if (result.kind === 'ok') {
    await bucket.putJson(
      bucketKeys.rawFilingsSidecar(target.state, date, target.source, hhmmss),
      {
        url,
        fetched_at: nowIso,
        status: result.status,
        etag: result.etag,
        last_modified: result.lastModified,
        sha256: result.sha256,
        bytes: result.bytes,
      },
      ListSidecarSchema,
    );
  }
  return result;
}

async function probeOne(
  fetcher: PipelineFetcher,
  bucket: DataBucket,
  target: ReachabilityTarget,
  nowIso: string,
): Promise<ResultRow> {
  const base = {
    state: target.state,
    source: target.source,
    kind: target.kind,
    target: target.url,
    host: hostOf(target.url),
    discovered: null,
  };
  const { verdict, decision } = await fetcher.robotsFor(target.url);
  const robots: ResultRow['robots'] =
    verdict.kind === 'rules'
      ? decision === 'disallowed'
        ? 'disallowed'
        : 'allowed'
      : verdict.kind;
  const head = { ...base, robots_status: verdict.status, robots };
  switch (robots) {
    case 'challenge':
      return {
        ...head,
        result: 'challenge',
        ...NOTHING_SENT,
        status: verdict.status,
        challenge: true,
      };
    case 'disallowed':
    case 'unavailable':
      return { ...head, result: 'disallowed', ...NOTHING_SENT };
    case 'allowed':
    case 'absent':
      break;
  }

  switch (target.kind) {
    case 'get':
      return {
        ...head,
        ...fromResult(await saveList(fetcher, bucket, target, target.url, nowIso)),
      };
    case 'playwright_export':
      return {
        ...head,
        ...fromResult(
          await fetcher.fetch({ url: target.url, class: 'adapter', state: target.state }),
        ),
      };
    case 'discover_get': {
      const page = await fetcher.fetch({ url: target.url, class: 'adapter', state: target.state });
      if (page.kind !== 'ok') {
        return { ...head, ...fromResult(page) };
      }
      const html = await bucket.getBytes(page.cacheKey);
      const link =
        html === null || target.linkPattern === null
          ? null
          : chooseListLink(Buffer.from(html).toString('utf8'), page.finalUrl, target.linkPattern);
      if (link === null) {
        return { ...head, result: 'error', ...NOTHING_SENT, status: page.status };
      }
      const list = await saveList(fetcher, bucket, target, link, nowIso);
      return { ...head, ...fromResult(list), discovered: link };
    }
  }
}

/** Probes each target in order; the report says how each answered, never what it said. */
export async function probeReachability(
  fetcher: PipelineFetcher,
  bucket: DataBucket,
  targets: readonly ReachabilityTarget[],
  nowIso: string,
): Promise<ReachabilityReport> {
  const results: ResultRow[] = [];
  for (const target of targets) {
    results.push(await probeOne(fetcher, bucket, target, nowIso));
  }
  return ReachabilityReportSchema.parse({
    generated_at: nowIso,
    from: fetcher.origin,
    product_token: productToken(),
    results,
  });
}
