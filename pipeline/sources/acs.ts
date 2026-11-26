// ACS 5-year 2020-2024 table B01001 from the table-based Summary File (D-312): total population
// and population 18 and over per geography.
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { readDelimited } from '../lib/csv.ts';
import type { RunContext } from '../lib/runner.ts';
import {
  fetchDirectoryLinks,
  readDatasetRows,
  requireDatasetFile,
  writeDatasetRows,
} from './dataset.ts';

export const SOURCE_IDS = ['acs5'] as const;

export const ACS_DATASET = 'acs5';
export const ACS_EDITION = '2020-2024';
export const ACS_DIRECTORY =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/';
export const PARSED_ACS_FILE = 'parsed.ndjson.gz';
/** The national B01001 file is about 200 MB, above the fetcher's default download limit. */
const ACS_MAX_BYTES = 500_000_000;

/** Table B01001 itself, not its iterations B01001A to B01001I. */
const B01001_FILE = /(^|[-_])b01001\.dat$/i;

/** The summary levels kept: state, county, county subdivision, place and the three school district levels. */
export const ACS_SUMMARY_LEVELS: ReadonlySet<string> = new Set([
  '040',
  '050',
  '060',
  '160',
  '950',
  '960',
  '970',
]);

/** A directory with no B01001 file, or with more than one. */
export class AcsFileError extends Error {
  override readonly name = 'AcsFileError';
}

/** A B01001 file whose header lacks a column, or a kept row with an estimate that is not a count. */
export class AcsFormatError extends Error {
  override readonly name = 'AcsFormatError';
  readonly line: number;

  constructor(line: number, detail: string) {
    super(`B01001 line ${String(line)}: ${detail}`);
    this.line = line;
  }
}

export type AcsRow = {
  geo_id: string;
  sumlev: string;
  geoid: string;
  total: number;
  age18: number;
};

export const AcsRowSchema = z.strictObject({
  geo_id: z.string().min(1).max(60),
  sumlev: z.string().regex(/^\d{3}$/),
  geoid: z.string().regex(/^\d{1,40}$/),
  total: z.int().min(0),
  age18: z.int().min(0),
});

/** The B01001 file the directory page lists. */
export function pickB01001(names: readonly string[]): string {
  const found = names.filter((name) => B01001_FILE.test(name));
  if (found.length !== 1 || found[0] === undefined) {
    throw new AcsFileError(`the ACS directory lists ${String(found.length)} B01001 files, not one`);
  }
  return found[0];
}

/** Fetches the 5YRData directory page and picks the B01001 file. */
export async function listAcsFile(ctx: RunContext): Promise<{ name: string; url: string }> {
  const name = pickB01001(await fetchDirectoryLinks(ctx, ACS_DIRECTORY));
  return { name, url: `${ACS_DIRECTORY}${name}` };
}

/** Downloads (or confirms) the B01001 file into `datasets/acs5/2020-2024/`; returns its key. */
export async function ensureAcsFile(ctx: RunContext): Promise<string> {
  const { name, url } = await listAcsFile(ctx);
  return requireDatasetFile(ctx, {
    dataset: ACS_DATASET,
    edition: ACS_EDITION,
    url,
    file: name,
    sourceUrl: ACS_DIRECTORY,
    maxBytes: ACS_MAX_BYTES,
    // The host sends the .dat file with no Content-Type.
    expectContentType: /^$|^(application\/octet-stream|text\/plain)\b/i,
  });
}

const estimate = (n: number): string => `B01001_E${String(n).padStart(3, '0')}`;
const AGE18_CELLS: readonly number[] = [
  ...Array.from({ length: 19 }, (_, i) => 7 + i), // male, 18 and 19 years to 85 years and over
  ...Array.from({ length: 19 }, (_, i) => 31 + i), // female, the same groups
];

/** The geographic component of a GEO_ID: `00` is the whole geography; others are its parts. */
const WHOLE_GEOGRAPHY = /^\d{3}0000US\d+$/;

function count(value: string, line: number, column: string): number {
  if (!/^\d+$/.test(value)) {
    throw new AcsFormatError(line, `${column} is not a count`);
  }
  return Number.parseInt(value, 10);
}

/**
 * Streams the kept rows of a B01001 file: `total` is B01001_E001 and `age18` the sum of the male
 * and female groups from 18 and 19 years upward (E007 to E025 and E031 to E049). Only whole
 * geographies (component `00`) of ACS_SUMMARY_LEVELS are kept. A short or long line fails with its
 * line number (CsvFormatError); a kept row whose estimate is not a count throws AcsFormatError.
 */
export async function* readB01001(body: Readable): AsyncIterable<AcsRow> {
  let geoIndex = -1;
  let totalIndex = -1;
  let ageIndexes: number[] = [];
  let headed = false;
  for await (const { line, record } of readDelimited(body, {
    delimiter: '|',
    header: true,
    encoding: 'utf8',
  })) {
    if (!headed) {
      const at = (name: string): number => {
        const index = record.indexOf(name);
        if (index === -1) {
          throw new AcsFormatError(line, `the header has no ${name} column`);
        }
        return index;
      };
      geoIndex = at('GEO_ID');
      totalIndex = at(estimate(1));
      ageIndexes = AGE18_CELLS.map((n) => at(estimate(n)));
      headed = true;
      continue;
    }
    const geoId = record[geoIndex] ?? '';
    if (!WHOLE_GEOGRAPHY.test(geoId)) {
      continue;
    }
    const sumlev = geoId.slice(0, 3);
    if (!ACS_SUMMARY_LEVELS.has(sumlev)) {
      continue;
    }
    const total = count(record[totalIndex] ?? '', line, estimate(1));
    let age18 = 0;
    ageIndexes.forEach((index, i) => {
      age18 += count(record[index] ?? '', line, estimate(AGE18_CELLS[i] ?? 0));
    });
    yield { geo_id: geoId, sumlev, geoid: geoId.slice(geoId.indexOf('US') + 2), total, age18 };
  }
}

/** Writes the kept rows as `datasets/acs5/2020-2024/parsed.ndjson.gz`. */
export function writeParsedAcs(
  ctx: RunContext,
  rows: AsyncIterable<AcsRow> | Iterable<AcsRow>,
): Promise<{ key: string; rows: number; sha256: string }> {
  return writeDatasetRows(
    ctx,
    { dataset: ACS_DATASET, edition: ACS_EDITION, file: PARSED_ACS_FILE },
    rows,
  );
}

/** Reads `datasets/acs5/2020-2024/parsed.ndjson.gz`. */
export function readParsedAcs(ctx: RunContext): AsyncIterable<AcsRow> {
  return readDatasetRows(
    ctx,
    { dataset: ACS_DATASET, edition: ACS_EDITION, file: PARSED_ACS_FILE },
    AcsRowSchema,
  );
}
