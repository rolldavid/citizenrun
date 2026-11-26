// Statewide executives from the openstates/people repository (D-315): the repository tarball,
// downloaded once per run with its commit recorded, and its `data/<st>/executive/*.yml` files.
// Only the listed keys are read; email, offices, image and every other key are dropped at parse.
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';
import type { RunContext } from '../lib/runner.ts';
import { DataFileError, parseYaml } from '../lib/yaml.ts';
import { DatasetUnavailableError, openDatasetFile, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['openstates-people'] as const;

export const OPENSTATES_PEOPLE_DATASET = 'openstates-people';
export const OPENSTATES_PEOPLE_COMMIT_URL =
  'https://api.github.com/repos/openstates/people/commits/main';
export const OPENSTATES_PEOPLE_TARBALL =
  'https://github.com/openstates/people/archive/refs/heads/main.tar.gz';
const TARBALL_FILE = 'main.tar.gz';

export const EXECUTIVE_PATH = /^[^/]+\/data\/([a-z]{2})\/executive\/[^/]+\.yml$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** A tar stream that does not follow the ustar layout. The message never holds file content. */
export class TarFormatError extends Error {
  override readonly name = 'TarFormatError';
}

const BLOCK = 512;

/** Reads exact byte counts from a stream of chunks. */
class ByteReader {
  readonly #chunks: Buffer[] = [];
  #length = 0;
  #done = false;
  readonly #source: AsyncIterator<Buffer>;

  constructor(source: AsyncIterable<Buffer>) {
    this.#source = source[Symbol.asyncIterator]();
  }

  async #fill(n: number): Promise<boolean> {
    while (this.#length < n && !this.#done) {
      const next = await this.#source.next();
      if (next.done === true) {
        this.#done = true;
      } else if (next.value.length > 0) {
        this.#chunks.push(next.value);
        this.#length += next.value.length;
      }
    }
    return this.#length >= n;
  }

  #take(n: number): Buffer {
    const parts: Buffer[] = [];
    let wanted = n;
    while (wanted > 0) {
      const head = this.#chunks[0];
      if (head === undefined) {
        break;
      }
      if (head.length <= wanted) {
        parts.push(head);
        this.#chunks.shift();
        wanted -= head.length;
      } else {
        parts.push(head.subarray(0, wanted));
        this.#chunks[0] = head.subarray(wanted);
        wanted = 0;
      }
    }
    this.#length -= n - wanted;
    return parts.length === 1 && parts[0] !== undefined ? parts[0] : Buffer.concat(parts);
  }

  /** Exactly `n` bytes, or null at the end of the stream before any byte; throws when cut short. */
  async read(n: number): Promise<Buffer | null> {
    if (!(await this.#fill(n))) {
      if (this.#length === 0) {
        return null;
      }
      throw new TarFormatError('the archive ends inside an entry');
    }
    return this.#take(n);
  }

  /** Discards `n` bytes without holding them all. */
  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (this.#length === 0 && !(await this.#fill(1))) {
        throw new TarFormatError('the archive ends inside an entry');
      }
      const step = Math.min(left, this.#length);
      this.#take(step);
      left -= step;
    }
  }
}

function cString(block: Buffer, start: number, end: number): string {
  const slice = block.subarray(start, end);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8');
}

function octal(block: Buffer, start: number, end: number): number {
  const raw = cString(block, start, end).trim();
  if (!/^[0-7]+$/.test(raw)) {
    throw new TarFormatError('a header holds a size that is not octal');
  }
  return Number.parseInt(raw, 8);
}

/** The `key=value` records of a pax header (`<length> key=value\n` each). */
export function paxRecords(data: Buffer): ReadonlyMap<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) {
      break;
    }
    const length = Number.parseInt(data.subarray(at, space).toString('ascii'), 10);
    if (!Number.isInteger(length) || length <= space - at || at + length > data.length) {
      throw new TarFormatError('a pax record has a bad length');
    }
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) {
      records.set(record.slice(0, equals), record.slice(equals + 1));
    }
    at += length;
  }
  return records;
}

function padded(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

/**
 * The files of a gzip tar stream whose path `keep` accepts, with their bytes. ustar headers
 * (name, size, type, prefix), pax `x` headers (a `path` record names the next entry), the pax
 * global `g` header (passed to `onGlobalHeader`) and GNU `L` long names; two zero blocks end it.
 */
export async function* readTarGz(
  stream: Readable,
  keep: (path: string) => boolean,
  opts: { onGlobalHeader?: (records: ReadonlyMap<string, string>) => void } = {},
): AsyncIterable<{ path: string; bytes: Uint8Array }> {
  const gunzip = createGunzip();
  stream.on('error', (error) => gunzip.destroy(error));
  const reader = new ByteReader(stream.pipe(gunzip));
  let nextPath: string | null = null;
  let zeroBlocks = 0;
  try {
    for (;;) {
      const header = await reader.read(BLOCK);
      if (header === null) {
        return;
      }
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) {
          return;
        }
        continue;
      }
      zeroBlocks = 0;
      const size = octal(header, 124, 136);
      const type = String.fromCharCode(header[156] ?? 0);
      const name = cString(header, 0, 100);
      const prefix = cString(header, 257, 262) === 'ustar' ? cString(header, 345, 500) : '';
      const headerPath = prefix === '' ? name : `${prefix}/${name}`;
      switch (type) {
        case 'x':
        case 'g':
        case 'L': {
          const data = (await reader.read(padded(size))) ?? Buffer.alloc(0);
          const body = data.subarray(0, size);
          if (type === 'L') {
            nextPath = cString(body, 0, body.length);
          } else if (type === 'x') {
            nextPath = paxRecords(body).get('path') ?? nextPath;
          } else {
            opts.onGlobalHeader?.(paxRecords(body));
          }
          continue;
        }
        case '0':
        case '\0': {
          const path = nextPath ?? headerPath;
          nextPath = null;
          if (keep(path)) {
            const data = (await reader.read(padded(size))) ?? Buffer.alloc(0);
            yield { path, bytes: new Uint8Array(data.subarray(0, size)) };
          } else {
            await reader.skip(padded(size));
          }
          continue;
        }
        default:
          // A directory, a link or another entry type: no file content to read.
          nextPath = null;
          await reader.skip(padded(size));
      }
    }
  } finally {
    stream.unpipe(gunzip);
    gunzip.destroy();
  }
}

export type ExecutivePerson = {
  id: string;
  /** The postal code of the folder the file was read from (`data/<st>/executive/`). */
  state: string;
  name: string;
  givenName: string | null;
  familyName: string | null;
  party: string | null;
  roles: readonly { type: string; startDate: string | null; endDate: string | null }[];
  links: readonly string[];
  sources: readonly string[];
};

const DateValue = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === 'string' ? value : value.toISOString().slice(0, 10)))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const UrlList = z.array(z.object({ url: z.string().max(2000) })).max(100);

// z.object, not strictObject: the keys this module does not read are dropped at parse.
const ExecutiveFileSchema = z.object({
  id: z.string().regex(/^ocd-person\/[0-9a-f-]{36}$/),
  name: z.string().min(1).max(200),
  given_name: z.string().max(100).optional(),
  family_name: z.string().max(100).optional(),
  party: z
    .array(z.object({ name: z.string().max(100), end_date: DateValue.optional() }))
    .max(20)
    .optional(),
  roles: z
    .array(
      z.object({
        type: z.string().max(100),
        start_date: DateValue.optional(),
        end_date: DateValue.optional(),
      }),
    )
    .max(100)
    .optional(),
  links: UrlList.optional(),
  sources: UrlList.optional(),
});

const blankToNull = (value: string | undefined): string | null => {
  const trimmed = value?.replace(/\s+/g, ' ').trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** One executive file, read for the listed keys only; null when it does not parse or match. */
export function parseExecutive(text: string, state: string): ExecutivePerson | null {
  let raw: unknown;
  try {
    raw = parseYaml(text, 'executive');
  } catch (error) {
    if (error instanceof DataFileError) {
      return null;
    }
    throw error;
  }
  const parsed = ExecutiveFileSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const file = parsed.data;
  const party = file.party?.find((entry) => entry.end_date === undefined)?.name;
  return {
    id: file.id,
    state: state.toUpperCase(),
    name: file.name.replace(/\s+/g, ' ').trim(),
    givenName: blankToNull(file.given_name),
    familyName: blankToNull(file.family_name),
    party: blankToNull(party),
    roles: (file.roles ?? []).map((role) => ({
      type: role.type,
      startDate: role.start_date ?? null,
      endDate: role.end_date ?? null,
    })),
    links: (file.links ?? []).map((link) => link.url),
    sources: (file.sources ?? []).map((source) => source.url),
  };
}

export type ExecutiveOfficeType =
  'governor' | 'lieutenant_governor' | 'secretary-of-state' | 'attorney-general';

/** The office type of an Open States executive role, or null for every other role. */
export function executiveOfficeType(roleType: string): ExecutiveOfficeType | null {
  switch (roleType.trim().toLowerCase()) {
    case 'governor':
      return 'governor';
    case 'lt_governor':
    case 'lieutenant governor':
      return 'lieutenant_governor';
    case 'secretary of state':
    case 'secretary_of_state':
      return 'secretary-of-state';
    case 'attorney general':
    case 'attorney_general':
      return 'attorney-general';
    default:
      return null;
  }
}

/** A role is current when it has not ended before `today` and has started by `today`. */
export function isCurrentRole(
  role: { startDate: string | null; endDate: string | null },
  today: string,
): boolean {
  return (
    (role.endDate === null || role.endDate >= today) &&
    (role.startDate === null || role.startDate <= today)
  );
}

const CommitSchema = z.object({ sha: z.string().regex(COMMIT) });

async function headCommit(ctx: RunContext): Promise<string> {
  const result = await ctx.fetcher.fetch({ url: OPENSTATES_PEOPLE_COMMIT_URL, class: 'api' });
  if (result.kind !== 'ok') {
    throw new DatasetUnavailableError(
      OPENSTATES_PEOPLE_DATASET,
      result.kind === 'disallowed' || result.kind === 'error' ? result.reason : result.kind,
    );
  }
  const bytes = await ctx.bucket.getBytes(result.cacheKey);
  let sha: string | null = null;
  if (bytes !== null) {
    try {
      const parsed = CommitSchema.safeParse(JSON.parse(Buffer.from(bytes).toString('utf8')));
      sha = parsed.success ? parsed.data.sha : null;
    } catch {
      sha = null;
    }
  }
  if (sha === null) {
    throw new DatasetUnavailableError(OPENSTATES_PEOPLE_DATASET, 'commit_unreadable');
  }
  return sha;
}

export type Executives = {
  readonly key: string;
  /** The edition the file is stored under: the commit the GitHub API named. */
  readonly edition: string;
  /** The commit the tarball holds: its pax global `comment`, else the edition. */
  readonly commit: string;
  readonly people: readonly ExecutivePerson[];
  /** Executive files that did not parse or match. */
  readonly invalid: number;
};

// Per bucket, so two test contexts with one run id never share a result.
const memo = new WeakMap<object, Map<string, Promise<Executives>>>();

async function load(ctx: RunContext): Promise<Executives> {
  const edition = await headCommit(ctx);
  const key = await requireDatasetFile(ctx, {
    dataset: OPENSTATES_PEOPLE_DATASET,
    edition,
    url: OPENSTATES_PEOPLE_TARBALL,
    file: TARBALL_FILE,
  });
  const global: { comment: string | null } = { comment: null };
  const people: ExecutivePerson[] = [];
  let invalid = 0;
  const entries = readTarGz(await openDatasetFile(ctx, key), (path) => EXECUTIVE_PATH.test(path), {
    onGlobalHeader(records) {
      global.comment = records.get('comment') ?? null;
    },
  });
  for await (const entry of entries) {
    const state = EXECUTIVE_PATH.exec(entry.path)?.[1] ?? '';
    const person = parseExecutive(Buffer.from(entry.bytes).toString('utf8'), state);
    if (person === null) {
      invalid += 1;
    } else {
      people.push(person);
    }
  }
  let commit = edition;
  const named = global.comment;
  if (named !== null && COMMIT.test(named) && named !== edition) {
    ctx.log.info('openstates_people.commit_moved', { edition, commit: named });
    commit = named;
  }
  people.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { key, edition, commit, people, invalid };
}

/**
 * Every executive file of the repository at the current `main` commit, read once per run id.
 * Throws DatasetUnavailableError when the commit or the tarball cannot be had and no earlier copy
 * of that edition exists.
 */
export function loadExecutives(ctx: RunContext): Promise<Executives> {
  let runs = memo.get(ctx.bucket);
  if (runs === undefined) {
    runs = new Map();
    memo.set(ctx.bucket, runs);
  }
  let pending = runs.get(ctx.runId);
  if (pending === undefined) {
    const started = load(ctx);
    runs.set(ctx.runId, started);
    started.catch(() => runs.delete(ctx.runId));
    pending = started;
  }
  return pending;
}
