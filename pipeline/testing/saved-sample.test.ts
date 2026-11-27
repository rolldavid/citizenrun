import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SavedSampleMismatchError,
  SidecarSchema,
  readSavedSample,
  sidecarPath,
  writeSavedSample,
} from './saved-sample.ts';
import { PILOT_FILES, loadPilotUnits } from '../stages/pilots/harness.ts';

const PIPELINE_ROOT = join(import.meta.dirname, '..');
const META = '.meta.json';

/** Every `__fixtures__` folder under the pipeline package, outside node_modules. */
async function fixtureFolders(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.name === '__fixtures__') {
      found.push(path);
    } else {
      found.push(...(await fixtureFolders(path)));
    }
  }
  return found;
}

async function filesUnder(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'saved-sample-'));
  temps.push(dir);
  return dir;
}

const META_FIELDS = {
  url: 'https://www2.census.gov/geo/tiger/TIGER2026/STATE/',
  fetchedAt: '2026-11-26T19:05:24.205Z',
  contentType: 'text/html',
} as const;

describe('saved samples', () => {
  it('every sidecar under pipeline/**/__fixtures__ is valid and matches its file', async () => {
    const folders = await fixtureFolders(PIPELINE_ROOT);
    expect(folders.length).toBeGreaterThan(0);
    const problems: string[] = [];
    let checked = 0;
    for (const folder of folders) {
      const files = await filesUnder(folder);
      const names = new Set(files);
      // A pilot capture (D-895) is a stage output, not a fetched document: its capture.json is its
      // record, and the files it names are checked through it (schema, presence, row counts).
      const captured = new Set<string>();
      for (const record of files.filter((file) => file.endsWith('/capture.json'))) {
        const dir = dirname(record);
        try {
          await loadPilotUnits(dir);
        } catch (error) {
          problems.push(`${record}: ${error instanceof Error ? error.message : String(error)}`);
        }
        captured.add(record);
        for (const name of PILOT_FILES) {
          captured.add(join(dir, `${name}.ndjson.gz`));
        }
      }
      for (const file of files) {
        if (captured.has(file)) {
          checked += 1;
          continue;
        }
        const base = file.slice(file.lastIndexOf('/') + 1);
        if (file.endsWith(META)) {
          if (!names.has(file.slice(0, -META.length))) {
            problems.push(`${file}: a sidecar with no file`);
          }
          continue;
        }
        if (base.startsWith('zz-')) {
          continue;
        }
        try {
          const { bytes } = await readSavedSample(file);
          // The repository stores text files with LF (`* text=auto eol=lf`), so a text sample
          // holding a carriage return would no longer match its sidecar after a checkout.
          if (!bytes.includes(0) && bytes.includes(13)) {
            problems.push(`${file}: a text sample with CR line endings`);
          }
          checked += 1;
        } catch (error) {
          problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it('a changed byte fails', async () => {
    const dir = await tempDir();
    const path = join(dir, 'page.html');
    await writeSavedSample(path, Buffer.from('<html>saved</html>'), META_FIELDS);
    await expect(readSavedSample(path)).resolves.toMatchObject({ meta: META_FIELDS });
    const bytes = await readFile(path);
    bytes[1] = (bytes[1] ?? 0) ^ 1;
    await writeFile(path, bytes);
    await expect(readSavedSample(path)).rejects.toBeInstanceOf(SavedSampleMismatchError);
  });

  it('originalSha256 without transformations fails', async () => {
    const dir = await tempDir();
    const path = join(dir, 'cut.dat');
    const original = 'a'.repeat(64);
    expect(
      SidecarSchema.safeParse({ ...META_FIELDS, sha256: 'b'.repeat(64), originalSha256: original })
        .success,
    ).toBe(false);
    expect(
      SidecarSchema.safeParse({ ...META_FIELDS, sha256: 'b'.repeat(64), transformations: ['cut'] })
        .success,
    ).toBe(false);
    await expect(
      writeSavedSample(path, Buffer.from('x'), { ...META_FIELDS, originalSha256: original }),
    ).rejects.toThrow();
    await writeSavedSample(path, Buffer.from('x'), {
      ...META_FIELDS,
      originalSha256: original,
      transformations: ['kept one byte'],
    });
    const sidecar = JSON.parse(await readFile(sidecarPath(path), 'utf8')) as Record<
      string,
      unknown
    >;
    delete sidecar['transformations'];
    await writeFile(sidecarPath(path), JSON.stringify(sidecar));
    await expect(readSavedSample(path)).rejects.toThrow();
  });

  it('a sidecar with a key it does not define, or a transformation over 200 characters, fails', () => {
    const base = { ...META_FIELDS, sha256: 'b'.repeat(64) };
    expect(SidecarSchema.safeParse(base).success).toBe(true);
    expect(SidecarSchema.safeParse({ ...base, note: 'extra' }).success).toBe(false);
    expect(
      SidecarSchema.safeParse({
        ...base,
        originalSha256: 'a'.repeat(64),
        transformations: ['x'.repeat(201)],
      }).success,
    ).toBe(false);
    expect(
      SidecarSchema.safeParse({ ...base, originalSha256: 'a'.repeat(64), transformations: [] })
        .success,
    ).toBe(false);
    expect(SidecarSchema.safeParse({ ...base, url: 'http://www2.census.gov/' }).success).toBe(
      false,
    );
  });
});
