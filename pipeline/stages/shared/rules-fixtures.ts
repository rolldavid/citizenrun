// How many rules fixtures a state has and the newest retrieval date among them, read as text: the
// rules package reads no folder and is never imported by a deep path.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURE_FILE = /\.fixtures\.ts$/;
const RETRIEVED_ON = /retrievedOn:\s*'(\d{4}-\d{2}-\d{2})'/g;

/** The number of `<st>/*.fixtures.ts` files and their newest `retrievedOn`; a missing folder has none. */
export async function rulesFixtureInfo(
  root: string,
  state: string,
): Promise<{ readonly files: number; readonly newestRetrievedOn: string | null }> {
  const dir = join(root, 'packages', 'rules', 'src', '__fixtures__', state.toLowerCase());
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { files: 0, newestRetrievedOn: null };
    }
    throw error;
  }
  const files = names.filter((name) => FIXTURE_FILE.test(name)).sort();
  let newest: string | null = null;
  for (const name of files) {
    const text = await readFile(join(dir, name), 'utf8');
    for (const match of text.matchAll(RETRIEVED_ON)) {
      const date = match[1];
      if (date !== undefined && (newest === null || date > newest)) {
        newest = date;
      }
    }
  }
  return { files: files.length, newestRetrievedOn: newest };
}
