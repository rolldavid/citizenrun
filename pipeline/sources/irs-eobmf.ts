// The IRS Exempt Organizations Business Master File extract (PIPE-coops step 3): one CSV per state,
// of which only the organisation's EIN, name, city, state and subsection are read.
import type { Readable } from 'node:stream';
import { readDelimited } from '../lib/csv.ts';
import type { RunContext } from '../lib/runner.ts';
import { openDatasetFile, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['irs-eobmf'] as const;

export const EOBMF_DATASET = 'irs-eobmf';
/** The posting date of the extract the stage reads. */
export const EOBMF_EDITION = '2026-11-10';

/** The five columns read; every other column is dropped as the file is parsed. */
export const EOBMF_COLUMNS = ['EIN', 'NAME', 'CITY', 'STATE', 'SUBSECTION'] as const;

export type EoRow = {
  readonly ein: string;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  readonly subsection: string;
};

/** A file whose header lacks one of the five columns read. */
export class EoHeaderError extends Error {
  override readonly name = 'EoHeaderError';
}

export function eoBmfFile(state: string): string {
  return `eo_${state.toLowerCase()}.csv`;
}

export function eoBmfUrl(state: string): string {
  return `https://www.irs.gov/pub/irs-soi/${eoBmfFile(state)}`;
}

/** The rows of one extract file, with the five columns only; throws EoHeaderError on its header. */
export async function readEoRows(body: Readable): Promise<readonly EoRow[]> {
  const rows: EoRow[] = [];
  let at: readonly number[] | null = null;
  for await (const { record } of readDelimited(body, {
    delimiter: ',',
    header: true,
    encoding: 'utf8',
  })) {
    if (at === null) {
      const header = record.map((cell) => cell.trim());
      at = EOBMF_COLUMNS.map((column) => header.indexOf(column));
      if (at.some((index) => index === -1)) {
        throw new EoHeaderError('the EO BMF header lacks a column the stage reads');
      }
      continue;
    }
    const [ein, name, city, state, subsection] = at.map((index) => (record[index] ?? '').trim());
    if (ein === undefined || name === undefined || city === undefined || state === undefined)
      continue;
    if (!/^\d{9}$/.test(ein)) continue;
    rows.push({ ein, name, city, state, subsection: subsection ?? '' });
  }
  return rows;
}

const loaded = new WeakMap<
  RunContext,
  Map<string, Promise<{ key: string; rows: readonly EoRow[] }>>
>();

/** The state's extract, downloaded or confirmed through the fetcher, read once per run and state. */
export function loadEoBmf(
  ctx: RunContext,
  state: string,
): Promise<{ key: string; rows: readonly EoRow[] }> {
  let byState = loaded.get(ctx);
  if (byState === undefined) {
    byState = new Map();
    loaded.set(ctx, byState);
  }
  const states = byState;
  let found = states.get(state);
  if (found === undefined) {
    found = (async () => {
      const key = await requireDatasetFile(ctx, {
        dataset: EOBMF_DATASET,
        edition: EOBMF_EDITION,
        url: eoBmfUrl(state),
        file: eoBmfFile(state),
      });
      return { key, rows: await readEoRows(await openDatasetFile(ctx, key)) };
    })();
    states.set(state, found);
    found.catch(() => states.delete(state));
  }
  return found;
}

const ORG_TOKENS: Readonly<Record<string, string>> = {
  'co-op': 'cooperative',
  coop: 'cooperative',
  cooperative: 'cooperative',
  elec: 'electric',
  assn: 'association',
};
const DROPPED_TOKENS: ReadonlySet<string> = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'the',
  'llc',
]);

/**
 * An organisation name in the form EIA and IRS names are compared in: lower-case; `&` → `and`;
 * `co-op`, `coop`, `cooperative` → `cooperative`; `elec` → `electric`; `assn` → `association`;
 * punctuation and the tokens `inc`, `incorporated`, `corp`, `corporation`, `the`, `llc` removed;
 * spaces collapsed.
 */
export function normaliseOrgName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .split(/\s+/u)
    .map((token) => {
      const bare = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      return (ORG_TOKENS[bare] ?? bare).replace(/[^\p{L}\p{N}]/gu, '');
    })
    .filter((token) => token !== '' && !DROPPED_TOKENS.has(token))
    .join(' ');
}
