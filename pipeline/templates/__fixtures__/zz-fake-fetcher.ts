// A fetcher for template tests: it answers from a table, stores `ok` bodies in the run's bucket
// under their raw-cache key as the real fetcher does, and records every request.
import { createHash } from 'node:crypto';
import { createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import type { PipelineEnv } from '../../env.ts';
import { bucketKeys } from '../../lib/bucket.ts';
import type { DataBucket } from '../../lib/bucket.ts';
import type { FetchRequest, FetchResult, Fetcher } from '../../lib/fetch/types.ts';
import { createRunContext } from '../../lib/runner.ts';
import type { RunContext } from '../../lib/runner.ts';

export type FakeAnswer =
  | { readonly body: Uint8Array | string; readonly contentType: string }
  | Exclude<FetchResult, { kind: 'ok' }>;

export type FakeFetcher = Fetcher & { readonly requests: FetchRequest[] };

const EXTENSIONS: Readonly<Record<string, string>> = {
  'text/html': 'html',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

/** Answers each URL from `answers`; a URL the table does not hold is a network error. */
export function fakeFetcher(bucket: DataBucket, answers: Readonly<Record<string, FakeAnswer>>): FakeFetcher {
  const requests: FetchRequest[] = [];
  return {
    requests,
    async fetch(req) {
      requests.push(req);
      const answer = answers[req.url];
      if (answer === undefined) {
        return { kind: 'error', status: null, reason: 'network' };
      }
      if ('kind' in answer) {
        return answer;
      }
      const bytes = typeof answer.body === 'string' ? new TextEncoder().encode(answer.body) : answer.body;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const media = answer.contentType.split(';')[0]?.trim() ?? '';
      const cacheKey = bucketKeys.rawCache(sha256, EXTENSIONS[media] ?? 'bin');
      await bucket.putBytes(cacheKey, bytes, answer.contentType);
      return {
        kind: 'ok',
        finalUrl: req.url,
        status: 200,
        contentType: answer.contentType,
        etag: null,
        lastModified: null,
        sha256,
        bytes: bytes.byteLength,
        cacheKey,
      };
    },
    download() {
      return Promise.reject(new Error('the fake fetcher downloads nothing'));
    },
  };
}

export const FIXTURE_ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'unused',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'unused',
  DATA_SECRET_ACCESS_KEY: 'unused',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'error',
  PIPELINE_RUN_ID: null,
  FEC_API_KEY: null,
  isCi: false,
});

export function quietLog(): Logger {
  return createLogger({ service: 'pipeline', level: 'error', sink: () => undefined });
}

/** A run context over `bucket` and `fetcher` at the fixed instant `now`. */
export function fixtureContext(opts: {
  bucket: DataBucket;
  fetcher: Fetcher;
  now: Date;
  runId?: string;
  log?: Logger;
}): RunContext {
  return createRunContext({
    env: { ...FIXTURE_ENV, PIPELINE_RUN_ID: opts.runId ?? 'zz-fixture-run' },
    now: opts.now,
    bucket: opts.bucket,
    fetcher: opts.fetcher,
    log: opts.log ?? quietLog(),
  });
}
