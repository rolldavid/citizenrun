import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage } from '../testing/setup.ts';
import { bucketKeys, createDataBucket } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import { housekeeping } from './housekeeping.ts';
import { encodeNdjsonGz } from './ndjson.ts';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function put(bucket: DataBucket, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await bucket.putBytes(key, Buffer.from('x'), 'application/octet-stream');
  }
}

async function keysOf(bucket: DataBucket): Promise<string[]> {
  const out: string[] = [];
  for await (const info of bucket.list('')) {
    out.push(info.key);
  }
  return out.sort();
}

beforeEach(async () => {
  await resetStorage();
});

describe('housekeeping', () => {
  it('raw/filings older than 400 days by key date go', async () => {
    const { bucket } = await getTestBucket('data');
    const old = bucketKeys.rawFilings('ZZ', '2025-10-11', 'fixture-source', '120000', 'html');
    const kept = bucketKeys.rawFilings('ZZ', '2025-10-12', 'fixture-source', '120000', 'html');
    await put(bucket, [old, kept]);
    const report = await housekeeping(bucket, NOW, captureLogger().log);
    expect(report.rawFilings).toBe(1);
    expect(await keysOf(bucket)).toEqual([kept]);
  });

  it('only the two newest editions stay', async () => {
    const { bucket } = await getTestBucket('data');
    await put(bucket, [
      'datasets/acs5/2018-2022/b01001.csv',
      'datasets/acs5/2018-2022/parsed.ndjson.gz',
      'datasets/acs5/2019-2023/b01001.csv',
      'datasets/acs5/2020-2024/b01001.csv',
      'datasets/tiger/2026/state.zip',
    ]);
    const report = await housekeeping(bucket, NOW, captureLogger().log);
    expect(report.datasets).toBe(2);
    expect(await keysOf(bucket)).toEqual([
      'datasets/acs5/2019-2023/b01001.csv',
      'datasets/acs5/2020-2024/b01001.csv',
      'datasets/tiger/2026/state.zip',
    ]);
  });

  it('old cache objects go', async () => {
    const { bucket } = await getTestBucket('data');
    const orphan = bucketKeys.rawCache(hash('orphan'), 'html');
    const orphanText = bucketKeys.textCache(hash('orphan text'));
    const referenced = bucketKeys.rawCache(hash('referenced'), 'pdf');
    const referencedText = bucketKeys.textCache(hash('referenced text'));
    await put(bucket, [orphan, orphanText, referenced, referencedText]);
    await bucket.putBytes(
      bucketKeys.pages('ZZ'),
      encodeNdjsonGz([
        { url_id: 1, raw_sha256: hash('referenced'), text_sha256: hash('referenced text') },
        { url_id: 2, raw_sha256: null, text_sha256: null },
      ]),
      'application/gzip',
    );
    const uploaded = (await bucket.head(orphan))?.lastModified ?? new Date();
    // 400 days after the upload nothing goes; 401 days after, the unreferenced objects go.
    const at400 = new Date(uploaded.getTime() + 400 * DAY_MS - 60_000);
    expect((await housekeeping(bucket, at400, captureLogger().log)).cache).toBe(0);
    const at401 = new Date(uploaded.getTime() + 401 * DAY_MS);
    const report = await housekeeping(bucket, at401, captureLogger().log);
    expect(report.cache).toBe(2);
    expect(await keysOf(bucket)).toEqual(
      [bucketKeys.pages('ZZ'), referenced, referencedText].sort(),
    );
  });

  it('ai batches older than 60 days go with their open marker', async () => {
    const { bucket } = await getTestBucket('data');
    const keys = [
      bucketKeys.aiBatchManifest('msgbatch_fixture'),
      bucketKeys.aiBatchResults('msgbatch_fixture'),
      bucketKeys.aiBatchOpen('msgbatch_fixture'),
    ];
    await put(bucket, keys);
    const uploaded = (await bucket.head(keys[0] ?? ''))?.lastModified ?? new Date();
    expect(
      (await housekeeping(bucket, new Date(uploaded.getTime() + 59 * DAY_MS), captureLogger().log))
        .aiBatches,
    ).toBe(0);
    const report = await housekeeping(
      bucket,
      new Date(uploaded.getTime() + 61 * DAY_MS),
      captureLogger().log,
    );
    expect(report.aiBatches).toBe(3);
    expect(await keysOf(bucket)).toEqual([]);
  });

  it('ledger months older than 24 go', async () => {
    const { bucket } = await getTestBucket('data');
    await put(bucket, [
      bucketKeys.aiLedgerTotal('2024-10'),
      bucketKeys.aiLedgerRun('2024-10', 'run-1'),
      bucketKeys.aiLedgerTotal('2024-11'),
      bucketKeys.aiLedgerTotal('2026-11'),
    ]);
    const report = await housekeeping(bucket, NOW, captureLogger().log);
    expect(report.aiLedger).toBe(2);
    expect(await keysOf(bucket)).toEqual([
      bucketKeys.aiLedgerTotal('2024-11'),
      bucketKeys.aiLedgerTotal('2026-11'),
    ]);
  });

  it('never deletes bundles, assets, reports or field-reports', async () => {
    const { bucket } = await getTestBucket('data');
    const protectedKeys = [
      bucketKeys.bundleFile('20200101T000000Z-full', 'manifest.json'),
      bucketKeys.pointer('full'),
      bucketKeys.asset('photos', hash('photo'), 'jpg'),
      bucketKeys.coverage('20200101T000000Z-full'),
      bucketKeys.fieldReports('2020-01-01', 'fixture-export'),
    ].sort();
    await put(bucket, protectedKeys);
    const report = await housekeeping(
      bucket,
      new Date(Date.now() + 2000 * DAY_MS),
      captureLogger().log,
    );
    expect(report).toMatchObject({
      rawFilings: 0,
      cache: 0,
      datasets: 0,
      aiBatches: 0,
      aiLedger: 0,
    });
    expect(await keysOf(bucket)).toEqual(protectedKeys);
  });

  it('dry run deletes nothing', async () => {
    const { config } = await getTestBucket('data');
    const { bucket } = await getTestBucket('data');
    const keys = [
      bucketKeys.rawFilings('ZZ', '2020-01-01', 'fixture-source', '120000', 'html'),
      'datasets/acs5/2018-2022/b01001.csv',
      'datasets/acs5/2019-2023/b01001.csv',
      'datasets/acs5/2020-2024/b01001.csv',
    ];
    await put(bucket, keys);
    const { log, lines } = captureLogger();
    const dry = createDataBucket(config, { dryRun: true, log });
    const report = await housekeeping(dry, NOW, log);
    expect(report).toMatchObject({ dryRun: true, rawFilings: 1, datasets: 1 });
    expect(await keysOf(bucket)).toEqual([...keys].sort());
    const done = lines.find((line) => line.parsed.event === 'housekeeping.done');
    expect(done?.parsed).toMatchObject({ dryRun: true, rawFilings: 1, datasets: 1 });
    expect(done?.raw).not.toContain('raw/filings');
  });
});
