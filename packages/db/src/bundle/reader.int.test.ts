import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fixtureVersion,
  putTestObject,
  resetStorage,
  testDataBucketClient,
  writeFixtureBundle,
  zzBundle,
} from '../testing/index.ts';
import { BundleChecksumError, BundlePathError } from './errors.ts';
import { bucketReader } from './reader.ts';

const VERSION = fixtureVersion('2027-01-15T06:00:00Z', 'full');

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) {
    out.push(line);
  }
  return out;
}

beforeEach(async () => {
  await resetStorage();
});

describe('the bucket reader', () => {
  it('bucket reader streams lines and checks the hash', async () => {
    const { manifestKey } = await writeFixtureBundle({
      version: VERSION,
      files: zzBundle({ today: '2027-01-15' }),
    });
    const reader = bucketReader(testDataBucketClient(), manifestKey);
    const manifest = await reader.readManifest('manifest.json');
    const offices = manifest.files.find((file) => file.name === 'offices');
    expect(offices).toBeDefined();
    if (offices === undefined) {
      return;
    }
    const lines = await collect(reader.lines(offices.path, offices));
    expect(lines).toHaveLength(20);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ source_key: 'zz-fixture-seat-001' });
    await expect(
      collect(reader.lines(offices.path, { ...offices, bytes: offices.bytes + 1 })),
    ).rejects.toThrow(BundleChecksumError);
  });

  it('a missing object is a checksum error', async () => {
    const { manifestKey } = await writeFixtureBundle({
      version: VERSION,
      files: zzBundle({ today: '2027-01-15' }),
    });
    const reader = bucketReader(testDataBucketClient(), manifestKey);
    await expect(
      collect(reader.lines('nope.ndjson.gz', { sha256: '0'.repeat(64), bytes: 10 })),
    ).rejects.toThrow(BundleChecksumError);
  });

  it('a key outside bundles/ and assets/ is refused', async () => {
    const reader = bucketReader(testDataBucketClient(), `bundles/${VERSION}/manifest.json`);
    await expect(
      collect(reader.lines('../../reports/x.ndjson.gz', { sha256: '0'.repeat(64), bytes: 1 })),
    ).rejects.toThrow(BundlePathError);
  });

  it('the manifest is parsed strictly', async () => {
    const { manifestKey, manifest } = await writeFixtureBundle({
      version: VERSION,
      files: zzBundle({ today: '2027-01-15' }),
    });
    await putTestObject(
      'data',
      manifestKey,
      Buffer.from(JSON.stringify({ ...manifest, fixture_extra: true })),
      'application/json',
    );
    await expect(
      bucketReader(testDataBucketClient(), manifestKey).readManifest('manifest.json'),
    ).rejects.toThrow(ZodError);
  });
});
