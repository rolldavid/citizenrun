import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '../lib/paths.ts';

const TEMPLATE_FILE = /^[a-z]{2}\.yaml$/;

/** The repository's template folder, `data/templates/`. */
export function defaultTemplatesDir(): string {
  return join(repoRoot(), 'data', 'templates');
}

/** The `.yaml` files of `dir`, sorted by name; an absent folder has none. */
export async function listYamlFiles(dir: string): Promise<readonly string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return names
    .filter((name) => name.endsWith('.yaml'))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/**
 * The template files of `dir`, named `<st>.yaml` with a two-letter lower-case code, sorted by
 * name, with the state upper-cased. Any other `.yaml` file is reported by `checkTemplates`.
 */
export async function listTemplateFiles(
  dir: string,
): Promise<readonly { state: string; path: string }[]> {
  return (await listYamlFiles(dir))
    .filter((name) => TEMPLATE_FILE.test(name))
    .map((name) => ({ state: name.slice(0, 2).toUpperCase(), path: join(dir, name) }));
}

/** A template file's text, read as UTF-8. */
export async function readTemplateFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
