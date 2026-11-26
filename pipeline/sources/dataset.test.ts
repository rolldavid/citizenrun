import { describe, expect, it } from 'vitest';
import { bucketKeys } from '../lib/bucket.ts';
import {
  DatasetRecordMissingError,
  DatasetUnavailableError,
  EditionRecordSchema,
  datasetEntry,
  directoryLinks,
  ensureDatasetFile,
  readEditionRecord,
  requireDatasetFile,
} from './dataset.ts';
import type { EditionRecord } from './dataset.ts';
import { scriptedRun } from './dataset.fixtures.ts';
import type { Answer } from './dataset.fixtures.ts';

const URL = 'https://www2.census.gov/programs-surveys/fixture/2026/fixture.zip';
const FILE_KEY = bucketKeys.dataset('fixture-set', '2026', 'fixture.zip');
const RECORD_KEY = bucketKeys.dataset('fixture-set', '2026', '_edition.json');
const OPTS = { dataset: 'fixture-set', edition: '2026', url: URL, file: 'fixture.zip' } as const;
const OLD_BYTES = Buffer.from('PK old zip bytes');

const RECORD: EditionRecord = {
  dataset: 'fixture-set',
  edition: '2026',
  downloaded_on: '2026-11-01',
  source_url: URL,
  seeded: false,
  files: [
    {
      name: 'fixture.zip',
      url: URL,
      sha256: 'c'.repeat(64),
      bytes: OLD_BYTES.byteLength,
      etag: '"abc"',
      last_modified: 'Tue, 15 Sep 2026 14:08:55 GMT',
    },
  ],
};

async function seeded(answer: (url: string) => Answer | undefined) {
  const run = scriptedRun((url) => answer(url));
  await run.bucket.putBytes(FILE_KEY, OLD_BYTES, 'application/zip');
  await run.bucket.putJson(RECORD_KEY, RECORD, EditionRecordSchema);
  return run;
}

const partKeys = (keys: readonly string[]) => keys.filter((key) => key.includes('.part-'));

describe('ensureDatasetFile', () => {
  it('an HTML answer leaves the cached file intact', async () => {
    const { bucket, ctx, fetcher } = await seeded(() => ({
      kind: 'body',
      contentType: 'text/html; charset=utf-8',
      body: '<html><form>Accept the terms</form></html>',
    }));
    const before = await bucket.getBytes(RECORD_KEY);
    await expect(ensureDatasetFile(ctx, OPTS)).resolves.toEqual({ needsSeed: true });
    expect(Buffer.from((await bucket.getBytes(FILE_KEY)) ?? [])).toEqual(OLD_BYTES);
    expect(await bucket.getBytes(RECORD_KEY)).toEqual(before);
    expect(partKeys(bucket.keys())).toEqual([]);
    // The body went to a part key, never to the file's key.
    expect(fetcher.requests[0]?.key).toBe(`${FILE_KEY}.part-${ctx.runId}`);
  });

  it('sends the record conditional values and reuses the file on not_modified', async () => {
    const { bucket, ctx, fetcher } = await seeded(() => ({ kind: 'not_modified', finalUrl: URL }));
    await expect(ensureDatasetFile(ctx, OPTS)).resolves.toEqual({ key: FILE_KEY, fromCache: true });
    expect(fetcher.requests[0]?.req.conditional).toEqual({
      etag: '"abc"',
      lastModified: 'Tue, 15 Sep 2026 14:08:55 GMT',
    });
    expect(fetcher.requests[0]?.req.class).toBe('dataset');
    expect(partKeys(bucket.keys())).toEqual([]);
    // A second call in the same run makes no request.
    await expect(ensureDatasetFile(ctx, OPTS)).resolves.toEqual({ key: FILE_KEY, fromCache: true });
    expect(fetcher.requests).toHaveLength(1);
    expect(datasetEntry(ctx, 'fixture-set', '2026')).toEqual({
      edition: '2026',
      downloaded_on: '2026-11-01',
      source_url: URL,
    });
  });

  it('a new file is moved from its part key and recorded', async () => {
    const body = Buffer.from('PK new zip bytes');
    const { bucket, ctx, fetcher } = scriptedRun(() => ({
      kind: 'body',
      contentType: 'application/zip',
      body,
      lastModified: 'Thu, 26 Nov 2026 10:00:00 GMT',
    }));
    await expect(
      ensureDatasetFile(ctx, {
        ...OPTS,
        sourceUrl: 'https://www2.census.gov/programs-surveys/fixture/',
      }),
    ).resolves.toEqual({ key: FILE_KEY, fromCache: false });
    expect(fetcher.requests[0]?.req.conditional).toBeUndefined();
    expect(Buffer.from((await bucket.getBytes(FILE_KEY)) ?? [])).toEqual(body);
    expect(partKeys(bucket.keys())).toEqual([]);
    const record = await readEditionRecord(ctx, 'fixture-set', '2026');
    expect(record).toMatchObject({
      downloaded_on: '2026-11-26',
      source_url: 'https://www2.census.gov/programs-surveys/fixture/',
      seeded: false,
      files: [{ name: 'fixture.zip', url: URL, bytes: body.byteLength, etag: null }],
    });
  });

  it('a refusal, a challenge or an error keeps the file and the record', async () => {
    const answers: Answer[] = [
      { kind: 'disallowed', reason: 'robots' },
      { kind: 'challenge', status: 403 },
      { kind: 'error', status: 500, reason: 'http_status' },
    ];
    const reasons: unknown[] = [];
    for (const answer of answers) {
      const { bucket, ctx } = await seeded(() => answer);
      const before = await bucket.getBytes(RECORD_KEY);
      reasons.push(await ensureDatasetFile(ctx, OPTS));
      expect(Buffer.from((await bucket.getBytes(FILE_KEY)) ?? [])).toEqual(OLD_BYTES);
      expect(await bucket.getBytes(RECORD_KEY)).toEqual(before);
      expect(partKeys(bucket.keys())).toEqual([]);
      // requireDatasetFile falls back on the file the record lists.
      await expect(requireDatasetFile(ctx, OPTS)).resolves.toBe(FILE_KEY);
    }
    expect(reasons).toEqual([
      { failed: 'robots' },
      { failed: 'challenge' },
      { failed: 'http_status' },
    ]);
  });

  it('a content type the caller does not accept fails, and with no earlier file the dataset is unavailable', async () => {
    const { bucket, ctx } = scriptedRun(() => ({
      kind: 'body',
      contentType: 'application/pdf',
      body: '%PDF',
    }));
    const opts = { ...OPTS, expectContentType: /^application\/zip\b/ };
    await expect(ensureDatasetFile(ctx, opts)).resolves.toEqual({ failed: 'content_type' });
    expect(bucket.keys()).toEqual([]);
    await expect(requireDatasetFile(ctx, opts)).rejects.toBeInstanceOf(DatasetUnavailableError);
    expect(() => datasetEntry(ctx, 'fixture-set', '2026')).toThrow(DatasetRecordMissingError);
  });

  it('a terms gate with no earlier file is unavailable with needs_seed', async () => {
    const { ctx } = scriptedRun(() => ({
      kind: 'body',
      contentType: 'text/html',
      body: '<html></html>',
    }));
    await expect(requireDatasetFile(ctx, OPTS)).rejects.toMatchObject({
      name: 'DatasetUnavailableError',
      dataset: 'fixture-set',
      reason: 'needs_seed',
    });
  });

  it('an unconditional request sends no conditional values', async () => {
    const { ctx, fetcher } = await seeded(() => ({
      kind: 'body',
      contentType: 'application/zip',
      body: 'PK',
    }));
    await ensureDatasetFile(ctx, { ...OPTS, unconditional: true });
    expect(fetcher.requests[0]?.req.conditional).toBeUndefined();
  });
});

describe('directoryLinks', () => {
  it('keeps file and folder names and drops sort links and fragments', () => {
    const html =
      '<a href="?C=N;O=D">Name</a><a href="/geo/tiger/">Parent</a><a href="tl_2026_us_state.zip">x</a>' +
      '<a href="https://www.census.gov/">site</a><a href="Alabama/">Alabama</a><a href="#top">top</a>';
    expect(directoryLinks(html)).toEqual([
      'tiger/',
      'tl_2026_us_state.zip',
      'www.census.gov/',
      'Alabama/',
    ]);
  });
});
