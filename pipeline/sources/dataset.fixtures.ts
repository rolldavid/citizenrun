// Test helpers for the stage 1 source readers: a run context over a memory bucket and a fetcher
// that answers from a script, storing bodies where the real fetcher would.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { PipelineEnv } from '../env.ts';
import { quietLogger } from '../lib/fetch/test-fakes.ts';
import type { FetchRequest, FetchResult, Fetcher } from '../lib/fetch/types.ts';
import { createRunContext } from '../lib/runner.ts';
import type { RunContext } from '../lib/runner.ts';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import type { MemoryBucket } from '../testing/memory-bucket.ts';
import { readSavedSample } from '../testing/saved-sample.ts';

export const S01_FIXTURES = join(import.meta.dirname, '..', '__fixtures__', 's01');

/** The bytes of a saved sample under `__fixtures__/s01/`, checked against its sidecar. */
export async function s01Sample(rel: string): Promise<Uint8Array> {
  return (await readSavedSample(join(S01_FIXTURES, rel))).bytes;
}

/** A saved sample read without its sidecar check, for samples the sidecar test covers. */
export function s01Path(rel: string): string {
  return join(S01_FIXTURES, rel);
}

const ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'fixture',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture',
  DATA_SECRET_ACCESS_KEY: 'fixture',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'error',
  PIPELINE_RUN_ID: 'fixture-run',
  FEC_API_KEY: null,
  isCi: false,
});

/** One scripted answer: a body with its status and content type, or a result other than `ok`. */
export type Answer =
  | {
      kind: 'body';
      status?: number;
      contentType: string;
      body: Uint8Array | string;
      etag?: string | null;
      lastModified?: string | null;
    }
  | Exclude<FetchResult, { kind: 'ok' }>;

export type ScriptedFetcher = Fetcher & {
  readonly requests: { url: string; mode: 'fetch' | 'download'; req: FetchRequest; key?: string }[];
};

function ext(contentType: string): string {
  if (contentType.startsWith('text/html')) return 'html';
  if (contentType.startsWith('application/zip')) return 'zip';
  return 'bin';
}

/** A fetcher whose answers come from `script` by URL; an unscripted URL is an error result. */
export function scriptedFetcher(
  bucket: MemoryBucket,
  script: (url: string, req: FetchRequest) => Answer | undefined,
): ScriptedFetcher {
  const requests: ScriptedFetcher['requests'] = [];
  const answer = async (req: FetchRequest, key: string | null): Promise<FetchResult> => {
    const scripted = script(req.url, req) ?? { kind: 'error', status: 404, reason: 'http_status' };
    if (scripted.kind !== 'body') {
      return scripted;
    }
    const bytes = typeof scripted.body === 'string' ? Buffer.from(scripted.body) : scripted.body;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = key ?? `cache/raw/${sha256}.${ext(scripted.contentType)}`;
    await bucket.putBytes(target, bytes, scripted.contentType);
    return {
      kind: 'ok',
      finalUrl: req.url,
      status: scripted.status ?? 200,
      contentType: scripted.contentType,
      etag: scripted.etag ?? null,
      lastModified: scripted.lastModified ?? null,
      sha256,
      bytes: bytes.byteLength,
      cacheKey: target,
    };
  };
  return {
    requests,
    fetch(req) {
      requests.push({ url: req.url, mode: 'fetch', req });
      return answer(req, null);
    },
    download(req, key) {
      requests.push({ url: req.url, mode: 'download', req, key });
      return answer(req, key);
    },
  };
}

/** A run context over `bucket` and `fetcher`, fixed at 2026-11-26. */
export function testContext(
  bucket: MemoryBucket,
  fetcher: Fetcher,
  now = new Date('2026-11-26T12:00:00.000Z'),
): RunContext {
  return createRunContext({ env: ENV, now, bucket, fetcher, log: quietLogger() });
}

/** A memory bucket, a scripted fetcher and a context over both. */
export function scriptedRun(
  script: (url: string, req: FetchRequest) => Answer | undefined,
  now?: Date,
): {
  bucket: MemoryBucket;
  fetcher: ScriptedFetcher;
  ctx: RunContext;
} {
  const bucket = createMemoryBucket();
  const fetcher = scriptedFetcher(bucket, script);
  return { bucket, fetcher, ctx: testContext(bucket, fetcher, now) };
}
