import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FILES, FONT_VERSION } from '@citizenrun/shared';
import { repoRoot } from './lib/repo-root.ts';

/** The four WOFF2 file names the web export serves, in the order of `FONT_FILES`. */
export const WEB_FONT_FILES: readonly string[] = Object.values(FONT_FILES).map(
  (name) => `${name}.woff2`,
);

/**
 * Copies the four WOFF2 files from `sourceDir` into `targetDir`, creating it and overwriting what
 * is there. Returns the names of the files missing from `sourceDir`; nothing is copied when any is.
 */
export function copyWebFonts(sourceDir: string, targetDir: string): string[] {
  const missing = WEB_FONT_FILES.filter((name) => !existsSync(join(sourceDir, name)));
  if (missing.length > 0) {
    return missing;
  }
  mkdirSync(targetDir, { recursive: true });
  for (const name of WEB_FONT_FILES) {
    copyFileSync(join(sourceDir, name), join(targetDir, name));
  }
  return [];
}

/** Copies the committed fonts to `apps/mobile/public/fonts/<FONT_VERSION>/` (D-526). */
export function main(): number {
  const root = repoRoot();
  const sourceDir = join(root, 'packages/cards/assets/fonts');
  const targetDir = join(root, 'apps/mobile/public/fonts', FONT_VERSION);
  const missing = copyWebFonts(sourceDir, targetDir);
  for (const name of missing) {
    console.error(`font file missing: packages/cards/assets/fonts/${name}`);
  }
  return missing.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
