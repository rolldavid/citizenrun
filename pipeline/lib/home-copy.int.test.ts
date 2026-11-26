import { createHash } from 'node:crypto';
import { BundleManifestSchema, BundlePointerSchema } from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage } from '../testing/setup.ts';
import { bucketKeys, createDataBucket } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import {
  HOME_COPY_SOURCE,
  HomeCopyError,
  assertRemoteTarget,
  homeCopy,
  isNeverCopied,
} from './home-copy.ts';

const VERSION = '20261116T030000Z-full';
const FILE_BYTES = Buffer.from('fixture bundle file bytes');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const MANIFEST: BundleManifest = {
  format: 'citizenrun-bundle',
  kind: 'full',
  version: VERSION,
  schema_version: 1,
  schema_revision: 0,
  created_at: '2026-11-16T03:00:00.000Z',
  git_sha: 'f'.repeat(40),
  geometry_version: '20261116T000000Z-geometry',
  tiger_vintage: null,
  states: ['ZZ'],
  files: [
    {
      name: 'jurisdictions',
      state: null,
      path: 'jurisdictions.ndjson.gz',
      sha256: sha256(FILE_BYTES),
      bytes: FILE_BYTES.length,
      rows: 1,
    },
  ],
  assets: [],
  datasets: {},
  checks: [{ name: 'personal_data', passed: true, detail: 'Fixture check passed.' }],
  filing_sources: [],
  two_source_fields: 0,
  coverage_path: null,
  attribution_path: null,
};

const COPIED: Readonly<Record<string, string>> = {
  'datasets/fixture/2026/listing.csv': 'text/csv',
  'raw/filings/ZZ/2026-11-16/fixture-source/120000Z.html': 'text/html',
  'pipeline-state/hosts.json': 'application/json',
  'ai-ledger/2026-11/pipeline-total.json': 'application/json',
};

const NEVER: readonly string[] = [
  'bundles/index/loader.json',
  'field-reports/2026-11-16/fixture-export.ndjson.gz',
  'ai-ledger/2026-11/worker.json',
  'pipeline-state/field-reports/processed.json',
  'ml/x.ndjson',
  'models/m.onnx',
];

async function seed(source: DataBucket): Promise<void> {
  await source.putBytes(
    bucketKeys.bundleFile(VERSION, 'jurisdictions.ndjson.gz'),
    FILE_BYTES,
    'application/gzip',
  );
  await source.putJson(
    bucketKeys.bundleFile(VERSION, 'manifest.json'),
    MANIFEST,
    BundleManifestSchema,
  );
  await source.putJson(
    bucketKeys.pointer('full'),
    {
      kind: 'full',
      version: VERSION,
      manifest: `bundles/${VERSION}/manifest.json`,
      published_at: '2026-11-16T03:10:00.000Z',
    },
    BundlePointerSchema,
  );
  for (const [key, type] of Object.entries(COPIED)) {
    await source.putBytes(key, Buffer.from(`content of ${key}`), type);
  }
  for (const key of NEVER) {
    await source.putBytes(key, Buffer.from('local only'), 'application/octet-stream');
  }
}

async function keysOf(bucket: DataBucket): Promise<string[]> {
  const out: string[] = [];
  for await (const info of bucket.list('')) {
    out.push(info.key);
  }
  return out.sort();
}

/** A target that records the order of its copies. */
function recording(target: DataBucket, order: string[]): DataBucket {
  return {
    ...target,
    copyFrom: async (source, key) => {
      order.push(key);
      return target.copyFrom(source, key);
    },
  };
}

async function buckets() {
  const source = (await getTestBucket('data')).bucket;
  const target = (await getTestBucket('target')).bucket;
  await seed(source);
  return { source, target };
}

beforeEach(async () => {
  await resetStorage();
});

describe('homeCopy', () => {
  it('copies every object outside the never-copied list with key, length and content type', async () => {
    const { source, target } = await buckets();
    const { log, lines } = captureLogger();
    const report = await homeCopy(source, target, { dryRun: false, log });
    const expected = [
      ...Object.keys(COPIED),
      bucketKeys.bundleFile(VERSION, 'jurisdictions.ndjson.gz'),
      bucketKeys.bundleFile(VERSION, 'manifest.json'),
      bucketKeys.pointer('full'),
    ].sort();
    expect(await keysOf(target)).toEqual(expected);
    for (const key of expected) {
      const from = await source.head(key);
      const to = await target.head(key);
      expect(to?.size).toBe(from?.size);
      expect(to?.contentType).toBe(from?.contentType);
    }
    expect(report.neverCopied).toBe(NEVER.length);
    expect(report.copied.raw).toEqual({ objects: 1, bytes: expect.any(Number) as number });
    const done = lines.find((line) => line.parsed.event === 'home_copy.done');
    expect(done).toBeDefined();
    // A raw/ key is counted, never written to a log line.
    expect(lines.map((line) => line.raw).join('\n')).not.toContain('raw/filings');
  });

  it('never copies loader.json, field-reports, worker.json, processed.json, ml or models', async () => {
    const { source, target } = await buckets();
    await homeCopy(source, target, { dryRun: false, log: captureLogger().log });
    const copied = await keysOf(target);
    for (const key of NEVER) {
      expect(isNeverCopied(key)).toBe(true);
      expect(copied).not.toContain(key);
    }
    expect(isNeverCopied('mlx/a')).toBe(false);
    expect(isNeverCopied('modelsx/a')).toBe(false);
    expect(isNeverCopied('ai-ledger/2026-11/pipeline-total.json')).toBe(false);
    expect(isNeverCopied('bundles/index/full.json')).toBe(false);
  });

  it('writes the pointers last', async () => {
    const { source, target } = await buckets();
    const order: string[] = [];
    await homeCopy(source, recording(target, order), { dryRun: false, log: captureLogger().log });
    expect(order.at(-1)).toBe(bucketKeys.pointer('full'));
    expect(order.indexOf(bucketKeys.bundleFile(VERSION, 'manifest.json'))).toBeLessThan(
      order.indexOf(bucketKeys.pointer('full')),
    );
    const rest = order.slice(0, -1);
    expect(rest).toEqual([...rest].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  });

  it('a target key of a different length stops before any write', async () => {
    const { source, target } = await buckets();
    await target.putBytes('pipeline-state/hosts.json', Buffer.from('{}'), 'application/json');
    const order: string[] = [];
    const attempt = homeCopy(source, recording(target, order), {
      dryRun: false,
      log: captureLogger().log,
    });
    await expect(attempt).rejects.toMatchObject({
      errorCode: 'home_copy.target_differs',
      keys: ['pipeline-state/hosts.json'],
    });
    expect(order).toEqual([]);
    expect(await keysOf(target)).toEqual(['pipeline-state/hosts.json']);
  });

  it('a manifest file changed in the target fails the verify', async () => {
    const { source, target } = await buckets();
    // Same length, other bytes: skipped as present, then caught by the manifest's hash.
    const changed = Buffer.from(FILE_BYTES);
    changed[0] = changed[0] === 0x41 ? 0x42 : 0x41;
    await target.putBytes(
      bucketKeys.bundleFile(VERSION, 'jurisdictions.ndjson.gz'),
      changed,
      'application/gzip',
    );
    const attempt = homeCopy(source, target, { dryRun: false, log: captureLogger().log });
    await expect(attempt).rejects.toBeInstanceOf(HomeCopyError);
    await expect(attempt).rejects.toMatchObject({
      errorCode: 'home_copy.verify_failed',
      keys: [bucketKeys.bundleFile(VERSION, 'jurisdictions.ndjson.gz')],
    });
  });

  it('a target on localhost is refused', async () => {
    const { config } = await getTestBucket('target');
    expect(() => {
      assertRemoteTarget(HOME_COPY_SOURCE, config);
    }).toThrow(expect.objectContaining({ errorCode: 'home_copy.bad_target' }) as Error);
    for (const endpoint of ['http://127.0.0.1:8333', 'http://seaweedfs:8333']) {
      expect(() => {
        assertRemoteTarget(HOME_COPY_SOURCE, { ...config, endpoint });
      }).toThrow(HomeCopyError);
    }
    expect(() => {
      assertRemoteTarget(HOME_COPY_SOURCE, { ...HOME_COPY_SOURCE });
    }).toThrow(HomeCopyError);
    expect(() => {
      assertRemoteTarget(HOME_COPY_SOURCE, {
        ...config,
        endpoint: 'https://storage.example.test',
      });
    }).not.toThrow();
  });

  it('a second run copies nothing', async () => {
    const { source, target } = await buckets();
    await homeCopy(source, target, { dryRun: false, log: captureLogger().log });
    const order: string[] = [];
    const report = await homeCopy(source, recording(target, order), {
      dryRun: false,
      log: captureLogger().log,
    });
    expect(order).toEqual([]);
    expect(report.copied).toEqual({});
    expect(report.skippedPresent).toBe(Object.keys(COPIED).length + 3);
  });

  it('dry run writes nothing', async () => {
    const { source } = await buckets();
    const { config } = await getTestBucket('target');
    const { log, lines } = captureLogger();
    const dryTarget = createDataBucket(config, { dryRun: true, log });
    const report = await homeCopy(source, dryTarget, { dryRun: true, log });
    expect(await keysOf(dryTarget)).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.copied.bundles?.objects).toBe(3);
    expect(lines.some((line) => line.parsed.event === 'home_copy.done')).toBe(true);
  });
});
