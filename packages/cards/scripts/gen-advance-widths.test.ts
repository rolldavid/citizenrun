import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FONT_FILES } from '@citizenrun/shared';
import { buildFontMetrics, fontMetricsText } from './gen-advance-widths.ts';

const PACKAGE_ROOT = join(import.meta.dirname, '..');
const FONT_DIR = join(PACKAGE_ROOT, 'assets', 'fonts');

const temporary: string[] = [];

afterEach(async () => {
  for (const folder of temporary.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

describe('buildFontMetrics', () => {
  it('reads the four faces', async () => {
    const metrics = await buildFontMetrics(FONT_DIR);
    expect(Object.keys(metrics)).toEqual(Object.values(FONT_FILES));
    for (const face of Object.values(metrics)) {
      expect(face.unitsPerEm).toBe(1000);
    }
  });

  it('the committed table is current', async () => {
    const text = fontMetricsText(await buildFontMetrics(FONT_DIR));
    expect(text).toBe(await readFile(join(PACKAGE_ROOT, 'src', 'font-metrics.json'), 'utf8'));
  });

  it('two runs are identical', async () => {
    const first = fontMetricsText(await buildFontMetrics(FONT_DIR));
    const second = fontMetricsText(await buildFontMetrics(FONT_DIR));
    expect(second).toBe(first);
  });

  it('a missing file fails', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cards-metrics-'));
    temporary.push(folder);
    const [missing = '', ...kept] = Object.values(FONT_FILES);
    for (const name of kept) {
      await copyFile(join(FONT_DIR, `${name}.ttf`), join(folder, `${name}.ttf`));
    }
    await expect(buildFontMetrics(folder)).rejects.toThrow(`${missing}.ttf`);
  });
});
