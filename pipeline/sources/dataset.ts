// The shared download helper of the bulk datasets (D-332, D-335): every file arrives through the
// fetcher into `datasets/<id>/<edition>/`, with an edition record beside it.
import type { Readable } from 'node:stream';
import { Hex64Schema, IsoDateSchema, SafeUrlSchema } from '@citizenrun/shared';
import { load } from 'cheerio';
import { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import type { FetchClass } from '../lib/fetch/types.ts';
import { NdjsonGzWriter, readNdjsonGz } from '../lib/ndjson.ts';
import type { RunContext } from '../lib/runner.ts';
import { toTempFile } from '../lib/zip.ts';

export const EDITION_RECORD_FILE = '_edition.json';

const EditionFileSchema = z.strictObject({
  name: z.string().min(1).max(200),
  url: SafeUrlSchema.nullable(),
  sha256: Hex64Schema,
  bytes: z.int().min(0),
  etag: z.string().max(500).nullable(),
  last_modified: z.string().max(100).nullable(),
});

export const EditionRecordSchema = z.strictObject({
  dataset: z.string().min(1).max(100),
  edition: z.string().min(1).max(100),
  downloaded_on: IsoDateSchema,
  source_url: SafeUrlSchema,
  seeded: z.boolean(),
  files: z.array(EditionFileSchema).max(1000),
});
export type EditionRecord = z.infer<typeof EditionRecordSchema>;

export type DatasetFileResult =
  { key: string; fromCache: boolean } | { needsSeed: true } | { failed: string };

export type EnsureDatasetFileOptions = {
  readonly dataset: string;
  readonly edition: string;
  readonly url: string;
  readonly file: string;
  readonly class?: FetchClass;
  readonly maxBytes?: number;
  readonly expectContentType?: RegExp;
  /** The edition record's `source_url` when the record is new; defaults to `url`. */
  readonly sourceUrl?: string;
  /** Sends no conditional request even when the record lists the file. */
  readonly unconditional?: boolean;
};

/** `datasetEntry` for a dataset edition this run has not read or written a record of. */
export class DatasetRecordMissingError extends Error {
  override readonly name = 'DatasetRecordMissingError';
}

type RunCache = {
  readonly records: Map<string, EditionRecord>;
  /** File keys already downloaded or confirmed unchanged in this run. */
  readonly confirmed: Set<string>;
};

const runCaches = new WeakMap<RunContext, RunCache>();

function runCache(ctx: RunContext): RunCache {
  let cache = runCaches.get(ctx);
  if (cache === undefined) {
    cache = { records: new Map(), confirmed: new Set() };
    runCaches.set(ctx, cache);
  }
  return cache;
}

const recordId = (dataset: string, edition: string): string => `${dataset}/${edition}`;

/** The edition record of a dataset edition, or null when there is none. */
export async function readEditionRecord(
  ctx: RunContext,
  dataset: string,
  edition: string,
): Promise<EditionRecord | null> {
  const record = await ctx.bucket.getJson(
    bucketKeys.dataset(dataset, edition, EDITION_RECORD_FILE),
    EditionRecordSchema,
  );
  if (record !== null) {
    runCache(ctx).records.set(recordId(dataset, edition), record);
  }
  return record;
}

async function writeEditionRecord(ctx: RunContext, record: EditionRecord): Promise<void> {
  await ctx.bucket.putJson(
    bucketKeys.dataset(record.dataset, record.edition, EDITION_RECORD_FILE),
    record,
    EditionRecordSchema,
  );
  runCache(ctx).records.set(recordId(record.dataset, record.edition), record);
}

const HTML = /^text\/html\b/i;

/**
 * Makes sure one file of a dataset edition is in the bucket. The body always lands at a part key
 * first and is copied to the file's key only when the answer is the file: an HTML page where a
 * file was expected is a terms gate or an error page (`needsSeed`, never parsed, D-331 rule 2);
 * a refusal, a challenge or an error is `failed`, and the file's key and record stay as they were.
 */
export async function ensureDatasetFile(
  ctx: RunContext,
  opts: EnsureDatasetFileOptions,
): Promise<DatasetFileResult> {
  const fileKey = bucketKeys.dataset(opts.dataset, opts.edition, opts.file);
  const cache = runCache(ctx);
  if (cache.confirmed.has(fileKey)) {
    return { key: fileKey, fromCache: true };
  }
  const partKey = bucketKeys.dataset(opts.dataset, opts.edition, `${opts.file}.part-${ctx.runId}`);
  const record = await readEditionRecord(ctx, opts.dataset, opts.edition);
  const listed = record?.files.find((file) => file.name === opts.file) ?? null;
  const stored = listed === null ? null : await ctx.bucket.head(fileKey);
  const conditional =
    listed !== null && stored !== null && opts.unconditional !== true
      ? { etag: listed.etag, lastModified: listed.last_modified }
      : undefined;

  let result;
  try {
    result = await ctx.fetcher.download(
      {
        url: opts.url,
        class: opts.class ?? 'dataset',
        ...(conditional === undefined ? {} : { conditional }),
        ...(opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes }),
      },
      partKey,
    );
  } catch (error) {
    await ctx.bucket.delete([partKey]);
    throw error;
  }

  switch (result.kind) {
    case 'not_modified':
      await ctx.bucket.delete([partKey]);
      if (stored === null) {
        return { failed: 'not_modified_without_file' };
      }
      cache.confirmed.add(fileKey);
      return { key: fileKey, fromCache: true };
    case 'ok': {
      const contentType = result.contentType ?? '';
      const expected = opts.expectContentType;
      if (HTML.test(contentType) && (expected === undefined || !expected.test(contentType))) {
        await ctx.bucket.delete([partKey]);
        return { needsSeed: true };
      }
      if (expected !== undefined && !expected.test(contentType)) {
        await ctx.bucket.delete([partKey]);
        return { failed: 'content_type' };
      }
      const part = await ctx.bucket.getStream(partKey);
      if (part === null) {
        return { failed: 'part_missing' };
      }
      const written = await ctx.bucket.putStream(
        fileKey,
        part.body,
        result.contentType ?? 'application/octet-stream',
      );
      await ctx.bucket.delete([partKey]);
      const entry = {
        name: opts.file,
        url: SafeUrlSchema.safeParse(result.finalUrl).success ? result.finalUrl : opts.url,
        sha256: written.sha256,
        bytes: written.bytes,
        etag: result.etag,
        last_modified: result.lastModified,
      };
      const files = (record?.files ?? []).filter((file) => file.name !== opts.file);
      files.push(entry);
      files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      await writeEditionRecord(ctx, {
        dataset: opts.dataset,
        edition: opts.edition,
        downloaded_on: ctx.today,
        source_url: record?.source_url ?? opts.sourceUrl ?? opts.url,
        seeded: record?.seeded ?? false,
        files,
      });
      cache.confirmed.add(fileKey);
      return { key: fileKey, fromCache: false };
    }
    case 'disallowed':
      await ctx.bucket.delete([partKey]);
      return { failed: result.reason };
    case 'challenge':
      await ctx.bucket.delete([partKey]);
      return { failed: 'challenge' };
    case 'error':
      await ctx.bucket.delete([partKey]);
      return { failed: result.reason };
  }
}

/**
 * The edition, download date and source of a dataset edition for `StageResult.datasets`, from the
 * record this run read or wrote. Throws when the run has seen no record of it.
 */
export function datasetEntry(
  ctx: RunContext,
  dataset: string,
  edition: string,
): { edition: string; downloaded_on: string; source_url: string } {
  const record = runCache(ctx).records.get(recordId(dataset, edition));
  if (record === undefined) {
    throw new DatasetRecordMissingError(`no edition record of ${dataset} ${edition} in this run`);
  }
  return {
    edition: record.edition,
    downloaded_on: record.downloaded_on,
    source_url: record.source_url,
  };
}

/** Writes rows as `datasets/<id>/<edition>/<file>` in deterministic gzip NDJSON. */
export async function writeDatasetRows(
  ctx: RunContext,
  where: { dataset: string; edition: string; file: string },
  rows:
    AsyncIterable<Readonly<Record<string, unknown>>> | Iterable<Readonly<Record<string, unknown>>>,
): Promise<{ key: string; rows: number; sha256: string }> {
  const key = bucketKeys.dataset(where.dataset, where.edition, where.file);
  const writer = new NdjsonGzWriter();
  const upload = ctx.bucket.putStream(key, writer.readable, 'application/gzip');
  const fill = async () => {
    try {
      for await (const row of rows as AsyncIterable<Readonly<Record<string, unknown>>>) {
        writer.write(row);
        if (writer.needsDrain) {
          await writer.drained();
        }
      }
    } catch (error) {
      writer.readable.destroy(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    return writer.end();
  };
  const [result] = await Promise.all([fill(), upload]);
  return { key, rows: result.rows, sha256: result.sha256 };
}

/** A dataset file that is not in the bucket. */
export class DatasetFileMissingError extends Error {
  override readonly name = 'DatasetFileMissingError';
  readonly objectKey: string;

  constructor(key: string) {
    super(`the dataset file ${key} is not in the bucket`);
    this.objectKey = key;
  }
}

/** Reads `datasets/<id>/<edition>/<file>` row by row; throws when the file is absent. */
export async function* readDatasetRows<T>(
  ctx: RunContext,
  where: { dataset: string; edition: string; file: string },
  schema: z.ZodType<T>,
): AsyncIterable<T> {
  const key = bucketKeys.dataset(where.dataset, where.edition, where.file);
  const found = await ctx.bucket.getStream(key);
  if (found === null) {
    throw new DatasetFileMissingError(key);
  }
  yield* readNdjsonGz(found.body, schema);
}

/** The body of a stored dataset file; throws when it is absent. */
export async function openDatasetFile(ctx: RunContext, key: string): Promise<Readable> {
  const found = await ctx.bucket.getStream(key);
  if (found === null) {
    throw new DatasetFileMissingError(key);
  }
  return found.body;
}

/** A stored dataset file copied to a temporary file, for readers that need random access. */
export async function datasetTempFile(
  ctx: RunContext,
  key: string,
  suffix: string,
): Promise<{ path: string; remove(): Promise<void> }> {
  return toTempFile(await openDatasetFile(ctx, key), suffix);
}

/**
 * A dataset file the run cannot use: `needs_seed` (a terms gate, OI-local-fetches) or the
 * fetcher's reason, with no earlier copy of the file to fall back on.
 */
export class DatasetUnavailableError extends Error {
  override readonly name = 'DatasetUnavailableError';
  readonly dataset: string;
  readonly reason: string;

  constructor(dataset: string, reason: string) {
    super(`the dataset ${dataset} is unavailable: ${reason}`);
    this.dataset = dataset;
    this.reason = reason;
  }
}

/**
 * `ensureDatasetFile`, then the key to read: the new or unchanged file, or, when the request
 * failed or met a terms gate, the file the edition record already lists. Throws
 * DatasetUnavailableError when there is none.
 */
export async function requireDatasetFile(
  ctx: RunContext,
  opts: EnsureDatasetFileOptions,
): Promise<string> {
  const result = await ensureDatasetFile(ctx, opts);
  if ('key' in result) {
    return result.key;
  }
  const reason = 'needsSeed' in result ? 'needs_seed' : result.failed;
  const record = runCache(ctx).records.get(recordId(opts.dataset, opts.edition));
  const fileKey = bucketKeys.dataset(opts.dataset, opts.edition, opts.file);
  if (
    record?.files.some((file) => file.name === opts.file) === true &&
    (await ctx.bucket.head(fileKey)) !== null
  ) {
    ctx.log.warn('dataset.previous_file', { dataset: opts.dataset, edition: opts.edition, reason });
    return fileKey;
  }
  throw new DatasetUnavailableError(opts.dataset, reason);
}

/**
 * The link targets of a directory listing page, as written in its `a[href]` attributes, with
 * any path before the last `/` of a file link and any query or fragment dropped. Folder links
 * keep their trailing `/`.
 */
export function directoryLinks(html: string): readonly string[] {
  const $ = load(html);
  const names = new Set<string>();
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (href === undefined || href === '' || href.startsWith('?') || href.startsWith('#')) {
      return;
    }
    const bare = href.replace(/[?#].*$/, '');
    const folder = bare.endsWith('/');
    const trimmed = folder ? bare.slice(0, -1) : bare;
    const last = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    if (last !== '') {
      names.add(folder ? `${last}/` : last);
    }
  });
  return [...names];
}

/** A directory page the run could not read. */
export class DirectoryPageError extends Error {
  override readonly name = 'DirectoryPageError';
  readonly reason: string;

  constructor(reason: string) {
    super(`a dataset directory page could not be read: ${reason}`);
    this.reason = reason;
  }
}

/** Fetches a directory page (a `dataset`-class request) and returns its links. */
export async function fetchDirectoryLinks(
  ctx: RunContext,
  url: string,
): Promise<readonly string[]> {
  const result = await ctx.fetcher.fetch({ url, class: 'dataset' });
  if (result.kind !== 'ok') {
    throw new DirectoryPageError(
      result.kind === 'disallowed' || result.kind === 'error' ? result.reason : result.kind,
    );
  }
  if (!HTML.test(result.contentType ?? '')) {
    throw new DirectoryPageError('not_html');
  }
  const bytes = await ctx.bucket.getBytes(result.cacheKey);
  if (bytes === null) {
    throw new DirectoryPageError('not_cached');
  }
  return directoryLinks(Buffer.from(bytes).toString('latin1'));
}
