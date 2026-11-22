import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';

/** Formats `text` as the repository's Prettier configuration formats the file at `filePath`. */
export async function formatText(filePath: string, text: string): Promise<string> {
  const config = await resolveConfig(filePath);
  return format(text, { ...config, filepath: filePath });
}

/** Writes `text` to `filePath` after formatting it, so `prettier --check` agrees with generated files. */
export async function writeFormatted(filePath: string, text: string): Promise<void> {
  await writeFile(filePath, await formatText(filePath, text), 'utf8');
}
