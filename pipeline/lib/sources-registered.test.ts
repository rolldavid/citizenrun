// Every source module declares the outside sources it reads as `SOURCE_IDS`, and every declared id,
// and every snapshot source, has an entry in data/sources.yaml (D-331 rule 5).
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSnapshotSources, loadSources } from './data-files.ts';
import { repoRoot } from './paths.ts';

const DECLARATION = /export\s+const\s+SOURCE_IDS\s*=\s*\[([^\]]*)\]\s*as\s+const/g;
const ID = /['"]([^'"]+)['"]/g;

async function moduleFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await moduleFiles(path)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

/** Every id the source modules under `dirs` declare in `SOURCE_IDS`. */
async function declaredIds(dirs: readonly string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const dir of dirs) {
    for (const file of await moduleFiles(dir)) {
      const source = await readFile(file, 'utf8');
      for (const declaration of source.matchAll(DECLARATION)) {
        for (const id of (declaration[1] ?? '').matchAll(ID)) {
          ids.add(id[1] ?? '');
        }
      }
    }
  }
  return ids;
}

/** The ids of `dirs` and of the snapshot register that have no data/sources.yaml entry, sorted. */
async function unregistered(dirs: readonly string[]): Promise<string[]> {
  const registered = new Set((await loadSources()).map((entry) => entry.id));
  const wanted = await declaredIds(dirs);
  for (const entry of await loadSnapshotSources()) {
    wanted.add(entry.source);
  }
  return [...wanted].filter((id) => !registered.has(id)).sort();
}

const SOURCE_DIRS = [
  join(repoRoot(), 'pipeline', 'sources'),
  join(repoRoot(), 'pipeline', 'crawlers'),
];

let temp: string | null = null;

afterEach(async () => {
  if (temp !== null) {
    await rm(temp, { recursive: true, force: true });
    temp = null;
  }
});

describe('the source register', () => {
  it('every adapter has a terms entry', async () => {
    expect(await unregistered(SOURCE_DIRS)).toEqual([]);
  });

  it('a declared id with no entry fails', async () => {
    temp = await mkdtemp(join(tmpdir(), 'sources-registered-'));
    await mkdir(join(temp, 'nested'));
    await writeFile(
      join(temp, 'nested', 'fixture-source.ts'),
      "export const SOURCE_IDS = ['nowhere', 'nc-sbe'] as const;\n",
    );
    await writeFile(
      join(temp, 'ignored.test.ts'),
      "export const SOURCE_IDS = ['test-only'] as const;\n",
    );
    expect(await unregistered([temp])).toEqual(['nowhere']);
  });
});
