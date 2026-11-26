import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { CompletedPart, S3Client } from '@aws-sdk/client-s3';
import type { Logger } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import type { z } from 'zod';
import type { PipelineEnv } from '../env.ts';
import type { StageId } from './runner.ts';

export type BucketConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** The pipeline's home bucket, from its environment (PIPE-bucket-layout). */
export function dataBucketConfig(env: PipelineEnv): BucketConfig {
  return {
    bucket: env.DATA_BUCKET,
    endpoint: env.DATA_ENDPOINT,
    region: env.DATA_REGION,
    accessKeyId: env.DATA_ACCESS_KEY_ID,
    secretAccessKey: env.DATA_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
}

export type ObjectInfo = { key: string; size: number; lastModified: Date };

export type DryRunCounts = ReadonlyMap<string, { objects: number; bytes: number }>;

/** Typed reads and writes of one bucket. Keys come from `bucketKeys`. */
export interface DataBucket {
  readonly name: string;
  /** True when every write method writes nothing and only counts. */
  readonly dryRun: boolean;
  getBytes(key: string): Promise<Uint8Array | null>;
  getStream(
    key: string,
  ): Promise<{ body: Readable; contentType: string | null; size: number } | null>;
  /** Throws BucketJsonError when the object exists but is not JSON or fails the schema. */
  getJson<T>(key: string, schema: z.ZodType<T>): Promise<T | null>;
  /** An index or total file: one that fails its schema reads as absent and logs `index_file.invalid`. */
  readIndexFile<T>(key: string, schema: z.ZodType<T>): Promise<T | null>;
  putBytes(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ sha256: string; bytes: number }>;
  /** Validates `value` with `schema` before writing it. */
  putJson<T>(key: string, value: T, schema: z.ZodType<T>): Promise<void>;
  /** Streams `body` to the bucket, as a multipart upload with 16 MiB parts when it is larger than one part. */
  putStream(
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<{ sha256: string; bytes: number }>;
  head(key: string): Promise<(ObjectInfo & { contentType: string | null }) | null>;
  list(prefix: string): AsyncIterable<ObjectInfo>;
  delete(keys: readonly string[]): Promise<void>;
  /** Copies `key` from `source` to the same key here, with its content type. */
  copyFrom(source: DataBucket, key: string): Promise<{ bytes: number }>;
  /** What a dry run would have written, per top-level prefix. Empty outside a dry run. */
  dryRunCounts(): DryRunCounts;
}

/** An object that exists but is not JSON or fails its schema. */
export class BucketJsonError extends Error {
  override readonly name = 'BucketJsonError';
  readonly objectKey: string;

  constructor(key: string) {
    super(`the object ${describeKey(key)} is not valid JSON of its schema`);
    this.objectKey = key;
  }
}

/** An object a copy needs that the source does not hold. */
export class BucketMissingError extends Error {
  override readonly name = 'BucketMissingError';
  readonly objectKey: string;

  constructor(key: string) {
    super(`the object ${describeKey(key)} does not exist`);
    this.objectKey = key;
  }
}

/** A delete the store refused for some keys. */
export class BucketDeleteError extends Error {
  override readonly name = 'BucketDeleteError';

  constructor(count: number) {
    super(`the store refused to delete ${String(count)} objects`);
  }
}

/** A key builder's input that is not of its form. */
export class BucketKeyError extends Error {
  override readonly name = 'BucketKeyError';
}

/** A key as it may appear in an error message: a key under `raw/` is never written out. */
export function describeKey(key: string): string {
  return key.startsWith(RAW_ROOT) ? 'under raw/' : key;
}

/** The top-level prefix of a key, the part before its first `/`. */
export function topLevelPrefix(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

// ---------------------------------------------------------------------------------------------
// Keys (PIPE-bucket-layout). No other module concatenates a key.

const RAW_ROOT = 'raw/';
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HOST_LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const HOST = new RegExp(`^${HOST_LABEL}(\\.${HOST_LABEL})*$`);
const STATE = /^[A-Z]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{1,10}$/;
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;
const STAGE = /^s\d{2}-[a-z]+(-[a-z]+)*$/;
const PASS = /^[A-Za-z0-9]{1,8}$/;
const BATCH_ID = /^[A-Za-z0-9_-]{1,100}$/;
const HHMMSS = /^([01]\d|2[0-3])[0-5]\d[0-5]\d$/;
const PART = /^[0-9]{1,10}$/;
const VERSION = /^(sample-)?\d{8}T\d{6}Z-[a-z]+$/;
const REL_PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

function check(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) {
    throw new BucketKeyError(`not a valid ${what}`);
  }
  return value;
}

function host(value: string): string {
  if (value.length > 253) {
    throw new BucketKeyError('not a valid host');
  }
  return check(value, HOST, 'host');
}

function date(value: string): string {
  check(value, DATE, 'date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BucketKeyError('not a valid date');
  }
  return value;
}

const state = (value: string): string => check(value, STATE, 'state code');
const sha = (value: string): string => check(value, SHA256, 'sha256');
const ext = (value: string): string => check(value, EXT, 'extension');
const name = (value: string): string => check(value, NAME, 'file name');
const runId = (value: string): string => check(value, RUN_ID, 'run id');
const stage = (value: StageId): string => check(value, STAGE, 'stage id');
const slug = (value: string): string => check(value, SLUG, 'id');
const month = (value: string): string => check(value, MONTH, 'month');
const batchId = (value: string): string => check(value, BATCH_ID, 'batch id');

function relPath(value: string): string {
  const segments = value.split('/');
  if (value.length > 300 || segments.some((segment) => !REL_PATH_SEGMENT.test(segment))) {
    throw new BucketKeyError('not a valid relative path');
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new BucketKeyError('not a valid relative path');
  }
  return value;
}

function filingName(hhmmss: string, part: string | undefined): string {
  check(hhmmss, HHMMSS, 'time');
  return part === undefined ? `${hhmmss}Z` : `${hhmmss}Z-${check(part, PART, 'part')}`;
}

/** One function per row of the bucket layout, each returning the exact key or prefix. */
export const bucketKeys = Object.freeze({
  dataset: (id: string, edition: string, file: string) =>
    `datasets/${slug(id)}/${name(edition)}/${name(file)}`,
  datasetPrefix: (id: string) => `datasets/${slug(id)}/`,
  robots: (h: string) => `cache/robots/${host(h)}.json`,
  rawCache: (sha256: string, extension: string) => `cache/raw/${sha(sha256)}.${ext(extension)}`,
  textCache: (textSha256: string) => `cache/text/${sha(textSha256)}.txt.gz`,
  hosts: () => 'pipeline-state/hosts.json',
  fetchQueue: (h: string) => `pipeline-state/fetch-queue/${host(h)}.json`,
  pages: (st: string) => `pipeline-state/pages/${state(st)}.ndjson.gz`,
  slugs: (kind: 'offices' | 'people') => `pipeline-state/slugs/${kind}.json.gz`,
  aiQueue: () => 'pipeline-state/ai/queue.ndjson.gz',
  fieldReportsProcessed: () => 'pipeline-state/field-reports/processed.json',
  stageOut: (s: StageId, st: string, file: string) =>
    `stage-out/${stage(s)}/${state(st)}/${name(file)}`,
  stagePart: (s: StageId, st: string, file: string, run: string) =>
    `stage-out/${stage(s)}/${state(st)}/${name(file)}.part-${runId(run)}`,
  stageMeta: (s: StageId, st: string) => `stage-out/${stage(s)}/${state(st)}/_meta.json`,
  stageFailed: (s: StageId, st: string, run: string) =>
    `stage-out/${stage(s)}/${state(st)}/_failed-${runId(run)}.json`,
  findings: (textSha256: string, pass: string) =>
    `extract/findings/${sha(textSha256)}/${check(pass, PASS, 'pass')}.json`,
  aiBatchManifest: (id: string) => `ai-batches/${batchId(id)}/manifest.json`,
  aiBatchResults: (id: string) => `ai-batches/${batchId(id)}/results.jsonl.gz`,
  aiBatchOpen: (id: string) => `ai-batches/open/${batchId(id)}.json`,
  aiLedgerRun: (m: string, run: string) => `ai-ledger/${month(m)}/pipeline/${runId(run)}.json`,
  aiLedgerStopped: (m: string) => `ai-ledger/${month(m)}/pipeline-stopped.json`,
  aiLedgerWorker: (m: string) => `ai-ledger/${month(m)}/worker.json`,
  aiLedgerTotal: (m: string) => `ai-ledger/${month(m)}/pipeline-total.json`,
  rawFilings: (
    st: string,
    d: string,
    source: string,
    hhmmss: string,
    extension: string,
    part?: string,
  ) =>
    `raw/filings/${state(st)}/${date(d)}/${slug(source)}/${filingName(hhmmss, part)}.${ext(extension)}`,
  rawFilingsSidecar: (st: string, d: string, source: string, hhmmss: string, part?: string) =>
    `raw/filings/${state(st)}/${date(d)}/${slug(source)}/${filingName(hhmmss, part)}.json`,
  asset: (kind: 'photos' | 'forms', sha256: string, extension: string) =>
    `assets/${kind}/${sha(sha256)}.${ext(extension)}`,
  bundleFile: (version: string, path: string) =>
    `bundles/${check(version, VERSION, 'bundle version')}/${relPath(path)}`,
  pointer: (kind: 'full' | 'filings' | 'geometry') => `bundles/index/${kind}.json`,
  loaderInfo: () => 'bundles/index/loader.json',
  coverage: (version: string) =>
    `reports/coverage/${check(version, VERSION, 'bundle version')}.json`,
  fieldReports: (d: string, exportId: string) =>
    `field-reports/${date(d)}/${runId(exportId)}.ndjson.gz`,
  formsManual: (st: string, sha256: string, extension: string) =>
    `forms/manual/${state(st)}/${sha(sha256)}.${ext(extension)}`,
  reachability: (d: string) => `pipeline-state/reachability/${date(d)}.json`,
  aiIncoming: (st: string, run: string) =>
    `pipeline-state/ai/incoming/${state(st)}/${runId(run)}.ndjson.gz`,
  aiCalibration: () => 'pipeline-state/ai/calibration.json',
  coopsUnresolved: () => 'pipeline-state/coops/unresolved-counties.json',
  formsState: (st: string) => `pipeline-state/forms/${state(st)}.json`,
  filingsAttempts: () => 'pipeline-state/filings/attempts.json',
  filingsPublished: () => 'pipeline-state/filings/published.json',
  filingsParts: (source: string) => `pipeline-state/filings/${slug(source)}.parts.json`,
  resultsState: (st: string, d: string) => `pipeline-state/results/${state(st)}/${date(d)}.json.gz`,
  aiBatchPending: (run: string, n: number) => {
    if (!Number.isInteger(n) || n < 0) {
      throw new BucketKeyError('not a valid batch number');
    }
    return `ai-batches/pending-${runId(run)}-${String(n)}/manifest.json`;
  },
  calibrationReport: (id: string) => `reports/calibration/${batchId(id)}.json`,

  // Listing prefixes.
  rawFilingsPrefix: (st?: string) =>
    st === undefined ? 'raw/filings/' : `raw/filings/${state(st)}/`,
  rawCachePrefix: () => 'cache/raw/',
  textCachePrefix: () => 'cache/text/',
  datasetsRoot: () => 'datasets/',
  pagesPrefix: () => 'pipeline-state/pages/',
  aiBatchesPrefix: () => 'ai-batches/',
  aiLedgerPrefix: () => 'ai-ledger/',
  stageOutPrefix: (s: StageId, st: string) => `stage-out/${stage(s)}/${state(st)}/`,
  bundlesPrefix: () => 'bundles/',
  bundlesIndexPrefix: () => 'bundles/index/',
  assetsPrefix: () => 'assets/',
  reportsPrefix: () => 'reports/',
  fieldReportsPrefix: () => 'field-reports/',
  mlPrefix: () => 'ml/',
  modelsPrefix: () => 'models/',
});

/** Reads the parts of a key back, for the callers that list a prefix and decide per key. */
export const bucketKeyParts = Object.freeze({
  /** `raw/filings/<ST>/<YYYY-MM-DD>/...`: the state and the key's date. */
  rawFilings(key: string): { state: string; date: string } | null {
    const match = /^raw\/filings\/([A-Z]{2})\/(\d{4}-\d{2}-\d{2})\//.exec(key);
    return match?.[1] === undefined || match[2] === undefined
      ? null
      : { state: match[1], date: match[2] };
  },
  /** `datasets/<id>/<edition>/<file>`: the dataset id and the edition. */
  dataset(key: string): { id: string; edition: string } | null {
    const match = /^datasets\/([^/]+)\/([^/]+)\/./.exec(key);
    return match?.[1] === undefined || match[2] === undefined
      ? null
      : { id: match[1], edition: match[2] };
  },
  /** `cache/raw/<sha256>.<ext>` and `cache/text/<sha256>.txt.gz`: the content hash. */
  cacheHash(key: string): string | null {
    const match =
      /^cache\/(?:raw\/([0-9a-f]{64})\.[a-z0-9]{1,10}|text\/([0-9a-f]{64})\.txt\.gz)$/.exec(key);
    return match === null ? null : (match[1] ?? match[2] ?? null);
  },
  /** `ai-batches/<id>/manifest.json`: the batch id. */
  aiBatchManifest(key: string): string | null {
    const match = /^ai-batches\/([^/]+)\/manifest\.json$/.exec(key);
    return match?.[1] === undefined || match[1] === 'open' ? null : match[1];
  },
  /** `ai-ledger/<yyyy-mm>/...`: the month. */
  aiLedgerMonth(key: string): string | null {
    const match = /^ai-ledger\/(\d{4}-(?:0[1-9]|1[0-2]))\//.exec(key);
    return match?.[1] ?? null;
  },
  /** `bundles/<version>/manifest.json`: the version. */
  bundleManifest(key: string): string | null {
    const match = /^bundles\/((?:sample-)?\d{8}T\d{6}Z-[a-z]+)\/manifest\.json$/.exec(key);
    return match?.[1] ?? null;
  },
});

// ---------------------------------------------------------------------------------------------
// The S3 bucket

/** 16 MiB: the largest body sent in one PutObject, and the size of every multipart part but the last. */
export const PART_SIZE = 16 * 1024 * 1024;
const DELETE_BATCH = 1000;

function errorName(err: unknown): string | null {
  return err instanceof Error ? err.name : null;
}

function httpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('$metadata' in err)) {
    return null;
  }
  const metadata: unknown = err.$metadata;
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) {
    return null;
  }
  return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : null;
}

function isNotFound(err: unknown): boolean {
  const errName = errorName(err);
  return errName === 'NoSuchKey' || errName === 'NotFound' || httpStatus(err) === 404;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function collect(body: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const all = Buffer.concat(chunks);
  return new Uint8Array(all.buffer, all.byteOffset, all.byteLength);
}

function parseJsonBytes<T>(key: string, bytes: Uint8Array, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new BucketJsonError(key);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BucketJsonError(key);
  }
  return result.data;
}

/**
 * The parts of a DataBucket that are the same for every store: JSON reads and writes, the
 * index-file rule and the copy. `createDataBucket` and the test harness's memory bucket share them.
 */
export function withCommonMethods(
  base: Omit<DataBucket, 'getBytes' | 'getJson' | 'readIndexFile' | 'putJson' | 'copyFrom'>,
  log: Logger,
): DataBucket {
  const bucket: DataBucket = {
    ...base,
    async getBytes(key) {
      const found = await base.getStream(key);
      return found === null ? null : collect(found.body);
    },
    async getJson(key, schema) {
      const bytes = await bucket.getBytes(key);
      return bytes === null ? null : parseJsonBytes(key, bytes, schema);
    },
    async readIndexFile(key, schema) {
      try {
        return await bucket.getJson(key, schema);
      } catch (error) {
        if (error instanceof BucketJsonError) {
          log.warn('index_file.invalid', { objectKey: key });
          return null;
        }
        throw error;
      }
    },
    async putJson(key, value, schema) {
      schema.parse(value);
      await base.putBytes(key, Buffer.from(JSON.stringify(value)), 'application/json');
    },
    async copyFrom(source, key) {
      const found = await source.getStream(key);
      if (found === null) {
        throw new BucketMissingError(key);
      }
      const written = await base.putStream(
        key,
        found.body,
        found.contentType ?? 'application/octet-stream',
      );
      return { bytes: written.bytes };
    },
  };
  return bucket;
}

/** A dry-run counter: every write adds its key's top-level prefix, one object and its bytes. */
export function dryRunCounter(): {
  counts: DryRunCounts;
  add(key: string, bytes: number): void;
} {
  const counts = new Map<string, { objects: number; bytes: number }>();
  return {
    counts,
    add(key, bytes) {
      const prefix = topLevelPrefix(key);
      const current = counts.get(prefix) ?? { objects: 0, bytes: 0 };
      counts.set(prefix, { objects: current.objects + 1, bytes: current.bytes + bytes });
    },
  };
}

async function hashStream(body: Readable): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function multipartOrSingle(
  client: S3Client,
  bucket: string,
  key: string,
  body: Readable,
  contentType: string,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  let pending: Buffer[] = [];
  let pendingLength = 0;
  const upload: { id: string | null } = { id: null };
  const parts: CompletedPart[] = [];

  const uploadPart = async (part: Buffer): Promise<void> => {
    if (upload.id === null) {
      const created = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      );
      if (created.UploadId === undefined) {
        throw new Error('the store gave no upload id');
      }
      upload.id = created.UploadId;
    }
    const partNumber = parts.length + 1;
    const result = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: upload.id,
        PartNumber: partNumber,
        Body: part,
        ContentLength: part.length,
      }),
    );
    parts.push({ PartNumber: partNumber, ETag: result.ETag });
  };

  try {
    for await (const chunk of body as AsyncIterable<Buffer | string>) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      hash.update(buffer);
      bytes += buffer.length;
      pending.push(buffer);
      pendingLength += buffer.length;
      // A part is cut only once more than one part's bytes are known, so a body of exactly
      // 16 MiB goes in one PutObject.
      while (pendingLength > PART_SIZE) {
        const joined = Buffer.concat(pending);
        await uploadPart(joined.subarray(0, PART_SIZE));
        const rest = joined.subarray(PART_SIZE);
        pending = [rest];
        pendingLength = rest.length;
      }
    }
    const last = Buffer.concat(pending);
    if (upload.id === null) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: last,
          ContentType: contentType,
          ContentLength: last.length,
        }),
      );
    } else {
      await uploadPart(last);
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: upload.id,
          MultipartUpload: { Parts: parts },
        }),
      );
    }
  } catch (error) {
    if (upload.id !== null) {
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: upload.id }))
        .catch(() => undefined);
    }
    body.destroy();
    throw error;
  }
  return { sha256: hash.digest('hex'), bytes };
}

// In Node the SDK's GetObject body is a Readable (an IncomingMessage with the SDK's helpers).
function toReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }
  throw new Error('the store returned a body that is not a stream');
}

/**
 * The bucket over S3 (`createS3Client`, as the worker calls it). With `dryRun`, every write method
 * writes nothing and adds the key's top-level prefix, object count and bytes to `dryRunCounts()`.
 * Nothing here logs a key under `raw/` or any object's content.
 */
export function createDataBucket(
  config: BucketConfig,
  opts: { dryRun: boolean; log: Logger },
): DataBucket {
  const client = createS3Client({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle,
  });
  const bucket = config.bucket;
  const counter = dryRunCounter();

  return withCommonMethods(
    {
      name: bucket,
      dryRun: opts.dryRun,
      async getStream(key) {
        try {
          const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          return {
            body: toReadable(result.Body),
            contentType: result.ContentType ?? null,
            size: result.ContentLength ?? 0,
          };
        } catch (error) {
          if (isNotFound(error)) {
            return null;
          }
          throw error;
        }
      },
      async putBytes(key, body, contentType) {
        const sha256 = sha256Hex(body);
        if (opts.dryRun) {
          counter.add(key, body.byteLength);
          return { sha256, bytes: body.byteLength };
        }
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.byteLength,
          }),
        );
        return { sha256, bytes: body.byteLength };
      },
      async putStream(key, body, contentType) {
        if (opts.dryRun) {
          const result = await hashStream(body);
          counter.add(key, result.bytes);
          return result;
        }
        return multipartOrSingle(client, bucket, key, body, contentType);
      },
      async head(key) {
        try {
          const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          return {
            key,
            size: result.ContentLength ?? 0,
            lastModified: result.LastModified ?? new Date(0),
            contentType: result.ContentType ?? null,
          };
        } catch (error) {
          if (isNotFound(error)) {
            return null;
          }
          throw error;
        }
      },
      async *list(prefix) {
        let token: string | undefined;
        do {
          const page = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              ...(token === undefined ? {} : { ContinuationToken: token }),
            }),
          );
          for (const item of page.Contents ?? []) {
            if (item.Key !== undefined) {
              yield {
                key: item.Key,
                size: item.Size ?? 0,
                lastModified: item.LastModified ?? new Date(0),
              };
            }
          }
          token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
        } while (token !== undefined);
      },
      async delete(keys) {
        if (opts.dryRun) {
          return;
        }
        for (let start = 0; start < keys.length; start += DELETE_BATCH) {
          const batch = keys.slice(start, start + DELETE_BATCH);
          const result = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
            }),
          );
          const refused = result.Errors?.length ?? 0;
          if (refused > 0) {
            throw new BucketDeleteError(refused);
          }
        }
      },
      dryRunCounts() {
        return counter.counts;
      },
    },
    opts.log,
  );
}
