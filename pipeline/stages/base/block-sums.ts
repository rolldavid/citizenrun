// The block sums of stage 1 (D-312) and the PostGIS validity check of the lookup geometry, run by
// psql in a scratch database the run creates and drops on the local PostGIS server (the pipeline's
// one database; it never connects to an app database).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { parse } from 'csv-parse/sync';
import { readNdjsonGz } from '../../lib/ndjson.ts';
import { repoRoot } from '../../lib/paths.ts';
import type { RunContext } from '../../lib/runner.ts';
import { BlockTableRowSchema } from '../../sources/pl94171.ts';

/** The fixed address of the PostGIS server: the job's service container, or the compose server. */
export const SCRATCH_SERVER = 'postgresql://citizenrun:citizenrun@localhost:5432/postgres';
export const BLOCK_SUMS_SQL = 'pipeline/sql/base/block-sums.sql';
export const SCRATCH_PREFIX = 'pipeline_scratch_';
/** Postgres truncates a longer identifier, and the drop would then miss the database. */
const MAX_IDENTIFIER_BYTES = 63;
const SCRATCH_NAME = /^pipeline_scratch_[A-Za-z0-9_-]+$/;
const STDERR_DETAIL_CHARS = 300;

/** A scratch database name the pipeline will not create or drop. */
export class ScratchNameError extends Error {
  override readonly name = 'ScratchNameError';
}

/** A psql run that ended with a non-zero exit code, or output the parser cannot read. */
export class BlockSumsError extends Error {
  override readonly name = 'BlockSumsError';
}

/** Refuses any name that is not `pipeline_scratch_<run id>` within Postgres's identifier length. */
export function assertScratchName(name: string): void {
  if (!name.startsWith(SCRATCH_PREFIX) || !SCRATCH_NAME.test(name)) {
    throw new ScratchNameError('a scratch database is named pipeline_scratch_<run id>');
  }
  if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) {
    throw new ScratchNameError('a scratch database name is at most 63 bytes');
  }
}

/** The scratch database of a run: `pipeline_scratch_<run id>`, checked. */
export function scratchDatabaseName(runId: string): string {
  const name = `${SCRATCH_PREFIX}${runId}`;
  assertScratchName(name);
  return name;
}

function databaseUrl(server: URL, name: string): string {
  const url = new URL(server.href);
  url.pathname = `/${encodeURIComponent(name)}`;
  url.search = '';
  return url.href;
}

function csvText(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function write(stdin: Writable, text: string): Promise<void> {
  if (!stdin.write(text)) {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        stdin.off('drain', onDrain);
        stdin.off('error', done);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onDrain = () => {
        done();
      };
      stdin.once('drain', onDrain);
      stdin.once('error', done);
    });
  }
}

/** Runs psql with an argument array; `feed` writes its standard input. Resolves to its standard output. */
function psql(
  database: string,
  args: readonly string[],
  feed?: (stdin: Writable) => Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-d', database, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // A psql that stops early closes its input; the exit code then says why.
    child.stdin.on('error', () => undefined);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString('utf8'));
        return;
      }
      const firstLine = Buffer.concat(err).toString('utf8').split('\n', 1)[0] ?? '';
      reject(
        new BlockSumsError(
          `psql exited with code ${String(code)}: ${firstLine.slice(0, STDERR_DETAIL_CHARS)}`,
        ),
      );
    });
    const fill = feed === undefined ? Promise.resolve() : feed(child.stdin);
    fill.then(
      () => child.stdin.end(),
      (error: unknown) => {
        child.stdin.destroy();
        child.kill();
        reject(
          error instanceof Error ? error : new BlockSumsError('the input could not be written'),
        );
      },
    );
  });
}

export type BlockSum = { p1: number; p3: number; blocks: number };

/** Reads the CSV lines `INVALID,<key>` and `<key>,<p1>,<p3>,<blocks>` that the SQL file writes. */
export function parseBlockSumsOutput(stdout: string): {
  sums: Map<string, BlockSum>;
  invalid: string[];
} {
  const records: string[][] = parse(stdout, { relax_column_count: true });
  const sums = new Map<string, BlockSum>();
  const invalid: string[] = [];
  for (const record of records) {
    if (record.length === 2 && record[0] === 'INVALID' && record[1] !== undefined) {
      invalid.push(record[1]);
      continue;
    }
    const [key, p1, p3, blocks] = record;
    if (
      record.length !== 4 ||
      key === undefined ||
      ![p1, p3, blocks].every((value) => value !== undefined && /^\d+$/.test(value))
    ) {
      throw new BlockSumsError('psql wrote a line the block sums do not define');
    }
    sums.set(key, { p1: Number(p1), p3: Number(p3), blocks: Number(blocks) });
  }
  return { sums, invalid };
}

/**
 * The P1 and P3 sums of the blocks each district's lookup geometry covers, and the districts whose
 * lookup geometry PostGIS finds invalid. Creates `pipeline_scratch_<run id>` with PostGIS, runs
 * `pipeline/sql/base/block-sums.sql` there with the blocks and districts on psql's standard input,
 * and drops the database whether the run succeeded or failed.
 */
export async function runBlockSums(
  input: {
    runId: string;
    blocksKey: string;
    districts: readonly { key: string; lookupWkbHex: string }[];
  },
  ctx: RunContext,
): Promise<{ sums: ReadonlyMap<string, BlockSum>; invalid: readonly string[] }> {
  const server = new URL(SCRATCH_SERVER);
  const name = scratchDatabaseName(input.runId);
  const started = Date.now();
  const state = /blocks-([A-Z]{2})\.ndjson\.gz$/.exec(input.blocksKey)?.[1] ?? null;
  if ((await ctx.bucket.head(input.blocksKey)) === null) {
    throw new BlockSumsError('the block table is not in the bucket');
  }
  assertScratchName(name);
  await psql(server.href, ['-c', `create database "${name}"`]);
  try {
    const database = databaseUrl(server, name);
    await psql(database, ['-c', 'create extension postgis']);
    const stdout = await psql(database, ['-f', join(repoRoot(), BLOCK_SUMS_SQL)], async (stdin) => {
      const blocks = await ctx.bucket.getStream(input.blocksKey);
      if (blocks === null) {
        throw new BlockSumsError('the block table is not in the bucket');
      }
      for await (const row of readNdjsonGz(blocks.body, BlockTableRowSchema)) {
        await write(
          stdin,
          `${csvText(row.geoid)},${String(row.p1)},${String(row.p3)},${String(row.lng)},${String(row.lat)}\n`,
        );
      }
      await write(stdin, '\\.\n');
      for (const district of input.districts) {
        await write(stdin, `${csvText(district.key)},${csvText(district.lookupWkbHex)}\n`);
      }
      await write(stdin, '\\.\n');
    });
    const result = parseBlockSumsOutput(stdout);
    ctx.log.info('block_sums.done', {
      state,
      districts: input.districts.length,
      invalid: result.invalid.length,
      durationMs: Date.now() - started,
    });
    return result;
  } finally {
    assertScratchName(name);
    await psql(server.href, ['-c', `drop database if exists "${name}" with (force)`]);
  }
}
