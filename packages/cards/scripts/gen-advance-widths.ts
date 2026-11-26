import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'fontkit';
import { FONT_FILES } from '@citizenrun/shared';
import type { FaceMetrics, FontMetrics } from '../src/layout-text.ts';

// CARD-font-metrics (D-272): reads the four committed TTF files and writes the advance-width table
// every canvas measures with. The advance is the default glyph's: no feature and no kerning is
// applied, which is what the server's renderer draws. `pnpm cards:gen` runs it.

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const FONT_FOLDER = 'assets/fonts';
const OUTPUT = 'src/font-metrics.json';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function faceMetrics(fontDir: string, name: string): Promise<FaceMetrics> {
  const fileName = `${name}.ttf`;
  let bytes: Uint8Array;
  try {
    bytes = await readFile(join(fontDir, fileName));
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`the font file ${fileName} is missing`, { cause: error });
    }
    throw error;
  }
  const font = create(bytes);
  if ('fonts' in font) {
    throw new Error(`${fileName} is a font collection, not one face`);
  }
  if (font.unitsPerEm !== 1000) {
    throw new Error(`${fileName} has ${String(font.unitsPerEm)} units per em, not 1000`);
  }
  const advances: Record<string, number> = {};
  for (const codePoint of [...font.characterSet].sort((a, b) => a - b)) {
    advances[String.fromCodePoint(codePoint)] = font.glyphForCodePoint(codePoint).advanceWidth;
  }
  return {
    unitsPerEm: 1000,
    capHeight: font.capHeight,
    xHeight: font.xHeight,
    ascent: font.ascent,
    descent: font.descent,
    advances,
  };
}

/** Reads the four TTF files under fontDir and returns the table. Throws when a file is missing or its unitsPerEm is not 1000. */
export async function buildFontMetrics(fontDir: string): Promise<FontMetrics> {
  return {
    [FONT_FILES.regular]: await faceMetrics(fontDir, FONT_FILES.regular),
    [FONT_FILES.medium]: await faceMetrics(fontDir, FONT_FILES.medium),
    [FONT_FILES.bold]: await faceMetrics(fontDir, FONT_FILES.bold),
    [FONT_FILES.mono]: await faceMetrics(fontDir, FONT_FILES.mono),
  };
}

/** The table as the committed file holds it: two-space JSON and one line feed. */
export function fontMetricsText(metrics: FontMetrics): string {
  return `${JSON.stringify(metrics, null, 2)}\n`;
}

/** Writes src/font-metrics.json under packageRoot; returns true when the file changed. */
export async function writeFontMetrics(packageRoot: string): Promise<boolean> {
  const text = fontMetricsText(await buildFontMetrics(join(packageRoot, FONT_FOLDER)));
  const path = join(packageRoot, OUTPUT);
  try {
    if ((await readFile(path, 'utf8')) === text) return false;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await writeFile(path, text);
  return true;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_PATH) {
  await writeFontMetrics(dirname(dirname(SCRIPT_PATH)));
}
