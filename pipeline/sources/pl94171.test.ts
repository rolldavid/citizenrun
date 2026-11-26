import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSources } from '../lib/data-files.ts';
import { storedZip } from '../lib/zip.fixtures.ts';
import { s01Sample, s01Path } from './dataset.fixtures.ts';
import {
  PL_FIELDS,
  PL_ROOT,
  PlJoinError,
  PlTotalsError,
  joinBlockPoints,
  plStateFolder,
  plStateTotals,
  readPlBlocks,
} from './pl94171.ts';
import type { PlBlock, PlFields } from './pl94171.ts';
import { readDbfFile } from './tiger.ts';

const CUT = 'pl94171/dc-cut/';
const FILES = ['dcgeo2020.pl', 'dc000012020.pl', 'dc000022020.pl'] as const;

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** The cut DC files zipped as the state zip holds them; `edit` may rewrite a file's text first. */
async function cutZip(
  edit: (name: string, text: string) => string = (_, text) => text,
): Promise<string> {
  const entries = [];
  for (const name of FILES) {
    const text = Buffer.from(await s01Sample(`${CUT}${name}`)).toString('latin1');
    entries.push({ name, data: Buffer.from(edit(name, text), 'latin1') });
  }
  const dir = await mkdtemp(join(tmpdir(), 'pl-'));
  temps.push(dir);
  const path = join(dir, 'dc2020.pl.zip');
  await writeFile(path, storedZip(entries));
  return path;
}

async function blocksOf(path: string, fields: PlFields = PL_FIELDS): Promise<PlBlock[]> {
  const out: PlBlock[] = [];
  for await (const block of readPlBlocks(path, fields)) out.push(block);
  return out;
}

const cutPoints = () =>
  readDbfFile(s01Path('tiger/tl_2026_11_tabblock20-cut.dbf'), [
    'GEOID20',
    'INTPTLAT20',
    'INTPTLON20',
  ]);

describe('pl94171', () => {
  it('joins the cut DC files by LOGRECNO', async () => {
    const path = await cutZip();
    const blocks = await blocksOf(path);
    expect(blocks).toHaveLength(20);
    // LOGRECNO 0004034 and 0004035, read by hand: P0010001 607 and 282, P0030001 579 and 267.
    expect(blocks.slice(0, 2)).toEqual([
      { geoid: '110010001011000', p1: 607, p3: 579 },
      { geoid: '110010001011001', p1: 282, p3: 267 },
    ]);
    expect(blocks.every((block) => /^11001\d{10}$/.test(block.geoid))).toBe(true);
    // The 040 line: DC's 2020 total and 18-and-over population.
    await expect(plStateTotals(path)).resolves.toEqual({ p1: 689545, p3: 575161 });
  });

  it('joins the blocks to the TIGER internal points, sorted by GEOID', async () => {
    const blocks = await blocksOf(await cutZip());
    const sums = blocks.reduce((acc, block) => ({ p1: acc.p1 + block.p1, p3: acc.p3 + block.p3 }), {
      p1: 0,
      p3: 0,
    });
    const rows = joinBlockPoints(blocks, await cutPoints(), sums);
    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.geoid)).toEqual([...rows.map((row) => row.geoid)].sort());
    expect(rows[0]).toMatchObject({ geoid: '110010001011000', p1: 607, p3: 579 });
    expect(
      rows.every((row) => row.lat > 38.7 && row.lat < 39.1 && row.lng > -77.2 && row.lng < -76.9),
    ).toBe(true);
    // A block present in one table and not the other throws.
    const points = await cutPoints();
    expect(() => joinBlockPoints(blocks, points.slice(1), sums)).toThrow(PlJoinError);
    expect(() => joinBlockPoints(blocks.slice(1), points, sums)).toThrow(PlJoinError);
  });

  it('the totals check catches a misread field', async () => {
    // A state made of the 20 cut blocks: the 040 line's P0010001 and P0030001 are set to the
    // blocks' sums, so the true positions pass and every other cell of the line keeps DC's value.
    const blocks = await blocksOf(await cutZip());
    const sums = blocks.reduce((acc, block) => ({ p1: acc.p1 + block.p1, p3: acc.p3 + block.p3 }), {
      p1: 0,
      p3: 0,
    });
    expect(sums).toEqual({ p1: 1939, p3: 1748 });
    const path = await cutZip((name, text) => {
      if (name === 'dcgeo2020.pl') return text;
      const value = name === 'dc000012020.pl' ? sums.p1 : sums.p3;
      return text.replace(/^(PLST\|DC\|000\|0[12]\|0000001\|)\d+/m, `$1${String(value)}`);
    });
    const points = await cutPoints();
    expect(joinBlockPoints(await blocksOf(path), points, await plStateTotals(path))).toHaveLength(
      20,
    );
    const shifted = { ...PL_FIELDS, seg1: { ...PL_FIELDS.seg1, p1: PL_FIELDS.seg1.p1 + 1 } };
    const misread = await blocksOf(path, shifted);
    const totals = await plStateTotals(path, shifted);
    expect(() => joinBlockPoints(misread, points, totals)).toThrow(PlTotalsError);
  });

  it('the redistricting directory and state folders are the register entry and the state names', async () => {
    const entry = (await loadSources()).find((source) => source.id === 'pl94171');
    expect(entry?.url).toBe(PL_ROOT);
    expect(plStateFolder('DC')).toBe('District_of_Columbia/');
    expect(plStateFolder('NC')).toBe('North_Carolina/');
  });
});
