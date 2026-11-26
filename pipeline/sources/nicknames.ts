// The national given-name alias list (B-given_name_aliases, D-291): `names.csv` of
// carltonnorthern/nicknames at a pinned commit, plus data/nicknames-supplement.yaml.
import { BGivenNameAliasSchema } from '@citizenrun/shared';
import type { BGivenNameAlias } from '@citizenrun/shared';
import { readDelimited } from '../lib/csv.ts';
import { loadNicknameSupplement } from '../lib/data-files.ts';
import type { NicknamePair } from '../lib/data-files.ts';
import type { RunContext } from '../lib/runner.ts';
import { openDatasetFile, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['nicknames'] as const;

export const NICKNAMES_DATASET = 'nicknames';
const NAMES_FILE = 'names.csv';
const RELATIONSHIP = 'has_nickname';
const COMMIT_SEGMENT = /^[0-9a-f]{40}$/;
const GIVEN_NAME = /^[a-z][a-z' -]{0,40}$/;

/** The `nicknames` URL names no 40-hex commit, so the file it reads could change under it. */
export class NicknamesUnpinnedError extends Error {
  override readonly name = 'NicknamesUnpinnedError';

  constructor() {
    super('the nicknames URL names no pinned commit');
  }
}

/** The 40-hex commit a `names.csv` URL is pinned to, or null. */
export function pinnedCommit(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  if (segments.at(-1) !== NAMES_FILE) {
    return null;
  }
  return segments.find((segment) => COMMIT_SEGMENT.test(segment)) ?? null;
}

/** NFD, combining marks removed, lower-cased, whitespace collapsed; null when it fails the pattern. */
export function givenName(value: string): string | null {
  const name = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return GIVEN_NAME.test(name) ? name : null;
}

const sourceKey = (canonical: string, alias: string): string => `${canonical}|${alias}`;

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/**
 * The alias rows of the file's records and the supplement, sorted by `source_key`. A pair in both
 * keeps the file's row; a record whose names fail the pattern is dropped and counted.
 */
export function buildGivenNameAliases(
  records: Iterable<readonly string[]>,
  supplement: readonly NicknamePair[],
): { rows: readonly BGivenNameAlias[]; dropped: number } {
  const rows = new Map<string, BGivenNameAlias>();
  let dropped = 0;
  for (const record of records) {
    if (record.length !== 3 || record[1]?.trim().toLowerCase() !== RELATIONSHIP) {
      continue;
    }
    const canonical = givenName(record[0] ?? '');
    const alias = givenName(record[2] ?? '');
    if (canonical === null || alias === null) {
      dropped += 1;
      continue;
    }
    const key = sourceKey(canonical, alias);
    rows.set(
      key,
      BGivenNameAliasSchema.parse({ source_key: key, canonical, alias, source: 'nicknames' }),
    );
  }
  for (const pair of supplement) {
    const key = sourceKey(pair.canonical, pair.alias);
    if (!rows.has(key)) {
      rows.set(
        key,
        BGivenNameAliasSchema.parse({
          source_key: key,
          canonical: pair.canonical,
          alias: pair.alias,
          source: 'supplement',
        }),
      );
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => byteOrder(a.source_key, b.source_key)),
    dropped,
  };
}

/**
 * The given-name aliases from `url` (the `nicknames` entry's pinned `names.csv`) and the
 * supplement. Throws NicknamesUnpinnedError before any request when `url` names no commit, and
 * DatasetUnavailableError when the file cannot be had.
 */
export async function loadNicknames(
  ctx: RunContext,
  url: string,
  opts: { supplement?: () => Promise<readonly NicknamePair[]> } = {},
): Promise<{ key: string; commit: string; rows: readonly BGivenNameAlias[]; dropped: number }> {
  const commit = pinnedCommit(url);
  if (commit === null) {
    throw new NicknamesUnpinnedError();
  }
  const key = await requireDatasetFile(ctx, {
    dataset: NICKNAMES_DATASET,
    edition: commit,
    url,
    file: NAMES_FILE,
  });
  const records: (readonly string[])[] = [];
  const body = await openDatasetFile(ctx, key);
  for await (const { record } of readDelimited(body, {
    delimiter: ',',
    header: true,
    encoding: 'utf8',
  })) {
    records.push(record);
  }
  const supplement = await (opts.supplement ?? (() => loadNicknameSupplement()))();
  const { rows, dropped } = buildGivenNameAliases(records, supplement);
  return { key, commit, rows, dropped };
}
