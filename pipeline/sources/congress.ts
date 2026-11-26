// `legislators-current.csv` of the congress-legislators project (D-314). Only the named columns are
// read; every other column (office addresses, phones, contact forms, birthdays and the rest) is
// dropped as each record is parsed (D-084).
import { Readable } from 'node:stream';
import { readDelimited } from '../lib/csv.ts';
import type { RunContext } from '../lib/runner.ts';
import { DatasetFileMissingError, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['congress-legislators'] as const;

export const CONGRESS_DATASET = 'congress-legislators';
export const LEGISLATORS_FILE = 'legislators-current.csv';
export const LEGISLATORS_URL =
  'https://unitedstates.github.io/congress-legislators/legislators-current.csv';

/** The columns the header must hold (PIPE-known-bodies). */
export const CONGRESS_REQUIRED = [
  'bioguide_id',
  'type',
  'state',
  'district',
  'senate_class',
  'party',
  'first_name',
  'middle_name',
  'last_name',
  'suffix',
  'full_name',
] as const;

/** Read when the header has them; not required. */
const CONGRESS_OPTIONAL = ['nickname', 'wikipedia_id'] as const;

type Column = (typeof CONGRESS_REQUIRED)[number] | (typeof CONGRESS_OPTIONAL)[number];

export type Legislator = {
  readonly bioguide: string;
  readonly type: 'rep' | 'sen';
  readonly state: string;
  readonly district: number | null;
  readonly senateClass: 1 | 2 | 3 | null;
  readonly party: string | null;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lastName: string;
  readonly suffix: string | null;
  readonly fullName: string;
  readonly nickname: string | null;
  readonly wikipediaTitle: string | null;
};

const BIOGUIDE = /^[A-Z]\d{6}$/;

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function senateClass(value: string): 1 | 2 | 3 | null {
  switch (value.trim()) {
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    default:
      return null;
  }
}

/** A representative's district: `0` for an at-large seat or a delegate; null when not a number. */
function district(value: string): number | null {
  const trimmed = value.trim();
  return /^\d{1,2}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * The file's members. A header missing any CONGRESS_REQUIRED name fails with the missing names. A
 * row whose `bioguide_id` is not a letter and six digits, or whose `type` is neither `rep` nor
 * `sen`, or that has no `full_name` or `last_name`, is dropped and counted in `dropped`.
 * `district` is read only for representatives.
 */
export async function parseLegislatorsCsv(
  text: string,
): Promise<
  | { ok: true; rows: readonly Legislator[]; dropped: number }
  | { ok: false; missing: readonly string[] }
> {
  const records = readDelimited(Readable.from([Buffer.from(text, 'utf8')]), {
    delimiter: ',',
    header: true,
    encoding: 'utf8',
  });
  let index: ReadonlyMap<Column, number> | null = null;
  const rows: Legislator[] = [];
  let dropped = 0;
  for await (const { record } of records) {
    if (index === null) {
      const header = record.map((name) => name.trim());
      const missing = CONGRESS_REQUIRED.filter((name) => !header.includes(name));
      if (missing.length > 0) {
        return { ok: false, missing };
      }
      const positions = new Map<Column, number>();
      for (const name of [...CONGRESS_REQUIRED, ...CONGRESS_OPTIONAL]) {
        const at = header.indexOf(name);
        if (at >= 0) {
          positions.set(name, at);
        }
      }
      index = positions;
      continue;
    }
    const at = index;
    const cell = (name: Column): string => {
      const position = at.get(name);
      return position === undefined ? '' : (record[position] ?? '');
    };
    const bioguide = cell('bioguide_id').trim();
    const type = cell('type').trim();
    const fullName = cell('full_name').trim();
    const lastName = cell('last_name').trim();
    if (
      !BIOGUIDE.test(bioguide) ||
      (type !== 'rep' && type !== 'sen') ||
      fullName === '' ||
      lastName === ''
    ) {
      dropped += 1;
      continue;
    }
    rows.push({
      bioguide,
      type,
      state: cell('state').trim(),
      district: type === 'rep' ? district(cell('district')) : null,
      senateClass: type === 'sen' ? senateClass(cell('senate_class')) : null,
      party: orNull(cell('party')),
      firstName: cell('first_name').trim(),
      middleName: orNull(cell('middle_name')),
      lastName,
      suffix: orNull(cell('suffix')),
      fullName,
      nickname: orNull(cell('nickname')),
      wikipediaTitle: orNull(cell('wikipedia_id')),
    });
  }
  if (index === null) {
    return { ok: false, missing: [...CONGRESS_REQUIRED] };
  }
  return { ok: true, rows, dropped };
}

const loads = new WeakMap<RunContext, Promise<{ key: string; text: string }>>();

/**
 * The national file for today's edition, downloaded through the fetcher once per run (memoised by
 * the run's context, which holds one `runId`), and its text.
 */
export function loadLegislators(ctx: RunContext): Promise<{ key: string; text: string }> {
  let load = loads.get(ctx);
  if (load === undefined) {
    load = (async () => {
      const key = await requireDatasetFile(ctx, {
        dataset: CONGRESS_DATASET,
        edition: ctx.today,
        file: LEGISLATORS_FILE,
        url: LEGISLATORS_URL,
      });
      const bytes = await ctx.bucket.getBytes(key);
      if (bytes === null) {
        throw new DatasetFileMissingError(key);
      }
      return { key, text: new TextDecoder('utf-8').decode(bytes) };
    })();
    // A failed download is not kept, so a later state of the run may try again.
    load.catch(() => loads.delete(ctx));
    loads.set(ctx, load);
  }
  return load;
}
