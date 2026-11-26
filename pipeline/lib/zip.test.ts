import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ZipEntryMissingError,
  ZipEntryNameError,
  listZip,
  openZipEntry,
  toTempFile,
} from './zip.ts';
import { storedZip } from './zip.fixtures.ts';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function zipFile(entries: { name: string; data: Uint8Array }[]): Promise<string> {
  const file = await toTempFile(Readable.from([storedZip(entries)]), '.zip');
  cleanups.push(() => file.remove());
  return file.path;
}

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

const SHAPE = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256));
const TEXT = Buffer.from('fixture readme\n');

describe('zip', () => {
  it('lists its two entries and streams one byte for byte', async () => {
    const path = await zipFile([
      { name: 'tl_fixture_99_place.shp', data: SHAPE },
      { name: 'docs/readme.txt', data: TEXT },
    ]);
    expect(await listZip(path)).toEqual([
      { name: 'tl_fixture_99_place.shp', size: 300 },
      { name: 'docs/readme.txt', size: TEXT.length },
    ]);
    expect((await bytesOf(await openZipEntry(path, 'tl_fixture_99_place.shp'))).equals(SHAPE)).toBe(
      true,
    );
    expect((await bytesOf(await openZipEntry(path, 'docs/readme.txt'))).equals(TEXT)).toBe(true);
  });

  it('an entry it does not hold throws', async () => {
    const path = await zipFile([{ name: 'a.txt', data: TEXT }]);
    await expect(openZipEntry(path, 'b.txt')).rejects.toThrow(ZipEntryMissingError);
  });

  it('a zip whose entry is named ../x throws', async () => {
    const path = await zipFile([
      { name: 'ok.txt', data: TEXT },
      { name: '../x', data: TEXT },
    ]);
    await expect(listZip(path)).rejects.toThrow(ZipEntryNameError);
    await expect(openZipEntry(path, '../x')).rejects.toThrow(ZipEntryNameError);
  });

  it('an entry name starting with / throws', async () => {
    const path = await zipFile([{ name: '/etc/x', data: TEXT }]);
    await expect(listZip(path)).rejects.toThrow(ZipEntryNameError);
  });

  it('toTempFile copies the body under the pipeline temporary folder and removes it', async () => {
    const file = await toTempFile(Readable.from([TEXT]), '.txt');
    expect(dirname(file.path)).toBe(join(tmpdir(), 'citizenrun-pipeline'));
    expect(file.path.endsWith('.txt')).toBe(true);
    expect((await readFile(file.path)).equals(TEXT)).toBe(true);
    await file.remove();
    expect(existsSync(file.path)).toBe(false);
    await expect(toTempFile(Readable.from([TEXT]), '/../x')).rejects.toThrow(TypeError);
  });

  it('a body that fails leaves no file behind', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('fixture stream failure'));
      },
    });
    const suffix = `.zz-failing-${String(process.pid)}-${String(Date.now())}`;
    await expect(toTempFile(failing, suffix)).rejects.toThrow('fixture stream failure');
    const left = await readdir(join(tmpdir(), 'citizenrun-pipeline'));
    expect(left.filter((name) => name.endsWith(suffix))).toEqual([]);
  });
});
