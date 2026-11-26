import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BundleChecksumError, BundlePathError } from './errors.ts';
import { diskReader } from './reader.ts';
import type { BundleReader } from './reader.ts';

// The disk reader on a temporary folder laid out like B-sample: full/, geometry/ and assets/.

const LINES = Array.from({ length: 2000 }, (_, i) =>
  JSON.stringify({ source_key: `fixture:${String(i)}` }),
);
const GZ = gzipSync(Buffer.from(`${LINES.join('\n')}\n`, 'utf8'));
const EXPECT = { sha256: createHash('sha256').update(GZ).digest('hex'), bytes: GZ.length };

let root = '';
let reader: BundleReader;

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) {
    out.push(line);
  }
  return out;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bundle-reader-'));
  await mkdir(join(root, 'sample', 'full'), { recursive: true });
  await mkdir(join(root, 'sample', 'geometry', 'geometry'), { recursive: true });
  await writeFile(join(root, 'sample', 'full', 'offices.ndjson.gz'), GZ);
  const flipped = Buffer.from(GZ);
  const middle = Math.floor(flipped.length / 2);
  flipped[middle] = (flipped[middle] ?? 0) ^ 0xff;
  await writeFile(join(root, 'sample', 'full', 'flipped.ndjson.gz'), flipped);
  await writeFile(join(root, 'sample', 'geometry', 'geometry', 'ZZ.ndjson.gz'), GZ);
  await writeFile(join(root, 'outside.ndjson.gz'), GZ);
  reader = diskReader(join(root, 'sample', 'full', 'manifest.json'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the disk reader', () => {
  it('disk reader verifies sha256 and bytes', async () => {
    expect(await collect(reader.lines('offices.ndjson.gz', EXPECT))).toEqual(LINES);
    expect(await collect(reader.lines('../geometry/geometry/ZZ.ndjson.gz', EXPECT))).toHaveLength(
      LINES.length,
    );
    const seen: string[] = [];
    const wrong = { ...EXPECT, sha256: '0'.repeat(64) };
    await expect(
      (async () => {
        for await (const line of reader.lines('offices.ndjson.gz', wrong)) {
          seen.push(line);
        }
      })(),
    ).rejects.toThrow(BundleChecksumError);
    // The hash is known only at the end: every line came before the failure.
    expect(seen).toHaveLength(LINES.length);
    await expect(
      collect(reader.lines('offices.ndjson.gz', { ...EXPECT, bytes: EXPECT.bytes + 1 })),
    ).rejects.toThrow(BundleChecksumError);
  });

  it('disk reader refuses a file outside the sample folder', async () => {
    await expect(collect(reader.lines('../../../../x', EXPECT))).rejects.toThrow(BundlePathError);
    await expect(collect(reader.lines('../../outside.ndjson.gz', EXPECT))).rejects.toThrow(
      BundlePathError,
    );
    await expect(reader.bytes('../../outside.ndjson.gz', EXPECT)).rejects.toThrow(BundlePathError);
  });

  it('a corrupt gzip is a checksum error', async () => {
    await expect(collect(reader.lines('flipped.ndjson.gz', EXPECT))).rejects.toThrow(
      BundleChecksumError,
    );
  });

  it('a missing file is a checksum error', async () => {
    await expect(collect(reader.lines('nope.ndjson.gz', EXPECT))).rejects.toThrow(
      BundleChecksumError,
    );
    await expect(reader.bytes('nope.ndjson.gz', EXPECT)).rejects.toThrow(BundleChecksumError);
  });

  it('bytes verifies the hash and reads no more than the expected size', async () => {
    expect(Buffer.from(await reader.bytes('offices.ndjson.gz', EXPECT)).equals(GZ)).toBe(true);
    await expect(
      reader.bytes('offices.ndjson.gz', { ...EXPECT, bytes: EXPECT.bytes - 1 }),
    ).rejects.toThrow(BundleChecksumError);
    await expect(
      reader.bytes('offices.ndjson.gz', { ...EXPECT, sha256: 'f'.repeat(64) }),
    ).rejects.toThrow(BundleChecksumError);
  });
});
