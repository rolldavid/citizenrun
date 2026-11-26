// The Open States people CSV of one state (D-313). Only ten columns are read; every other column,
// the address, phone and email columns included, is dropped as each record is parsed (D-084).
import { Readable } from 'node:stream';
import { SOURCE_URL_MAX, parseSafeUrl } from '@citizenrun/shared';
import { readDelimited } from '../lib/csv.ts';
import type { RunContext } from '../lib/runner.ts';
import { DatasetFileMissingError, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['openstates'] as const;

export const OPENSTATES_DATASET = 'openstates';

/** The header of the current-legislators file (PIPE-known-bodies). */
export const OPENSTATES_HEADER = [
  'id',
  'name',
  'current_party',
  'current_district',
  'current_chamber',
  'given_name',
  'family_name',
  'gender',
  'email',
  'biography',
  'birth_date',
  'death_date',
  'image',
  'links',
  'sources',
  'capitol_address',
  'capitol_voice',
  'capitol_fax',
  'district_address',
  'district_voice',
  'district_fax',
  'twitter',
  'youtube',
  'instagram',
  'facebook',
  'wikidata',
] as const;

/** The only columns the parser reads. */
export const OPENSTATES_READ = [
  'id',
  'name',
  'current_party',
  'current_district',
  'current_chamber',
  'given_name',
  'family_name',
  'image',
  'links',
  'sources',
] as const;

type ReadColumn = (typeof OPENSTATES_READ)[number];

export type OpenStatesChamber = 'upper' | 'lower' | 'legislature';

export type OpenStatesPerson = {
  readonly id: string;
  readonly name: string;
  readonly currentParty: string | null;
  readonly currentDistrict: string;
  readonly currentChamber: OpenStatesChamber;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly links: readonly string[];
  readonly sources: readonly string[];
};

const CHAMBERS: ReadonlySet<string> = new Set(['upper', 'lower', 'legislature']);

function isChamber(value: string): value is OpenStatesChamber {
  return CHAMBERS.has(value);
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A `links` or `sources` cell: URLs separated by `;` (and whitespace), empties removed. */
function splitUrls(value: string): readonly string[] {
  return value
    .split(/[;\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

/**
 * The file's people. The header must hold every name of OPENSTATES_HEADER, in any order and with
 * any extra columns; otherwise the missing names. A row whose `current_chamber` is not `upper`,
 * `lower` or `legislature`, or that has no `id` or `name`, is dropped and counted in `dropped`.
 * The `image` column is read and discarded here: it points at the legislature's own server and
 * never leaves this function (D-313).
 */
export async function parseOpenStatesCsv(
  text: string,
): Promise<
  | { ok: true; rows: readonly OpenStatesPerson[]; dropped: number }
  | { ok: false; missing: readonly string[] }
> {
  const records = readDelimited(Readable.from([Buffer.from(text, 'utf8')]), {
    delimiter: ',',
    header: true,
    encoding: 'utf8',
  });
  let index: Readonly<Record<ReadColumn, number>> | null = null;
  const rows: OpenStatesPerson[] = [];
  let dropped = 0;
  for await (const { record } of records) {
    if (index === null) {
      const header = record.map((name) => name.trim());
      const missing = OPENSTATES_HEADER.filter((name) => !header.includes(name));
      if (missing.length > 0) {
        return { ok: false, missing };
      }
      const positions: Partial<Record<ReadColumn, number>> = {};
      for (const name of OPENSTATES_READ) {
        positions[name] = header.indexOf(name);
      }
      index = positions as Record<ReadColumn, number>; // every read column was found above
      continue;
    }
    const at = index;
    const cell = (name: ReadColumn): string => record[at[name]] ?? '';
    const chamber = cell('current_chamber').trim();
    if (!isChamber(chamber) || cell('id').trim() === '' || cell('name').trim() === '') {
      dropped += 1;
      continue;
    }
    // `image` is deliberately not copied into the row (D-313).
    rows.push({
      id: cell('id').trim(),
      name: cell('name').trim(),
      currentParty: orNull(cell('current_party')),
      currentDistrict: cell('current_district').trim(),
      currentChamber: chamber,
      givenName: orNull(cell('given_name')),
      familyName: orNull(cell('family_name')),
      links: splitUrls(cell('links')),
      sources: splitUrls(cell('sources')),
    });
  }
  if (index === null) {
    return { ok: false, missing: [...OPENSTATES_HEADER] };
  }
  return { ok: true, rows, dropped };
}

const WIKIPEDIA_PREFIX = 'https://en.wikipedia.org/wiki/';
const WIKIPEDIA_MAX = 10;

/**
 * The English Wikipedia pages among the person's `links` then `sources`: https URLs that pass the
 * safe-URL check, whose host is en.wikipedia.org and whose path starts `/wiki/`; de-duplicated in
 * order, at most ten.
 */
export function wikipediaUrls(person: OpenStatesPerson): readonly string[] {
  const urls: string[] = [];
  for (const token of [...person.links, ...person.sources]) {
    const parsed = parseSafeUrl(token, SOURCE_URL_MAX);
    if (parsed === null || !parsed.url.startsWith(WIKIPEDIA_PREFIX)) {
      continue;
    }
    if (parsed.url.length === WIKIPEDIA_PREFIX.length || urls.includes(parsed.url)) {
      continue;
    }
    urls.push(parsed.url);
    if (urls.length === WIKIPEDIA_MAX) {
      break;
    }
  }
  return urls;
}

/** The state's file for today's edition, downloaded through the fetcher, and its text. */
export async function loadOpenStates(
  ctx: RunContext,
  state: string,
): Promise<{ key: string; text: string }> {
  const st = state.toLowerCase();
  const key = await requireDatasetFile(ctx, {
    dataset: OPENSTATES_DATASET,
    edition: ctx.today,
    file: `${st}.csv`,
    url: `https://data.openstates.org/people/current/${st}.csv`,
  });
  const bytes = await ctx.bucket.getBytes(key);
  if (bytes === null) {
    throw new DatasetFileMissingError(key);
  }
  return { key, text: new TextDecoder('utf-8').decode(bytes) };
}
