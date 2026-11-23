import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

type Tool = 'pg_dump' | 'pg_restore';

/** A PostgreSQL client tool that failed to start or exited non-zero. Its output is never kept. */
export class DumpFailedError extends Error {
  override readonly name = 'DumpFailedError';
  readonly tool: Tool;
  readonly exitCode: number | null;

  constructor(tool: Tool, exitCode: number | null) {
    super(`${tool} exited with code ${String(exitCode)}`);
    this.tool = tool;
    this.exitCode = exitCode;
  }
}

/** A dump whose table of contents lists no table data. */
export class DumpVerificationError extends Error {
  override readonly name = 'DumpVerificationError';

  constructor() {
    super('dump lists no table data');
  }
}

const TABLE_DATA_ENTRY = ' TABLE DATA ';
const ABORTED = 'aborted';
const MAX_VERSION_OUTPUT = 1024;

/** The reason a signal aborted with, as the error it is (a plain abort gives an AbortError). */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(ABORTED);
}

/**
 * Writes a custom-format dump of `databaseUrl` to `outFile` (PC9-06). Standard error is drained and
 * discarded: pg_dump prints connection details there. Rejects with DumpFailedError when the tool
 * cannot start or exits non-zero, and with `signal.reason` when the signal aborts (the child is
 * killed).
 */
export function runDump(databaseUrl: string, outFile: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const child = spawn(
      'pg_dump',
      [
        '--format=custom',
        '--compress=gzip:6',
        '--no-unlogged-table-data',
        '--lock-wait-timeout=60s',
        `--file=${outFile}`,
        `--dbname=${databaseUrl}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], signal, killSignal: 'SIGKILL' },
    );
    child.stderr.resume();
    let settled = false;
    const settle = (error: Error | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    };
    // The spawn error carries the arguments, the database URL among them: it is never passed on.
    child.on('error', () => {
      settle(signal.aborted ? abortReason(signal) : new DumpFailedError('pg_dump', null));
    });
    child.on('close', (code) => {
      if (signal.aborted) {
        settle(abortReason(signal));
      } else if (code === 0) {
        settle(null);
      } else {
        settle(new DumpFailedError('pg_dump', code));
      }
    });
  });
}

/**
 * Lists the dump with `pg_restore --list` and counts its TABLE DATA entries. Rejects with
 * DumpFailedError when pg_restore fails and with DumpVerificationError when the count is 0.
 */
export async function verifyDump(file: string): Promise<{ tableDataEntries: number }> {
  const child = spawn('pg_restore', ['--list', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', () => {
      resolve(null);
    });
    child.on('close', (code) => {
      resolve(code);
    });
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let tableDataEntries = 0;
  lines.on('line', (line) => {
    if (line.includes(TABLE_DATA_ENTRY)) {
      tableDataEntries += 1;
    }
  });
  const [code] = await Promise.all([exited, once(lines, 'close')]);
  if (code !== 0) {
    throw new DumpFailedError('pg_restore', code);
  }
  if (tableDataEntries === 0) {
    throw new DumpVerificationError();
  }
  return { tableDataEntries };
}

/** The trimmed output of `pg_dump --version`, for the manifest. */
export function pgDumpVersion(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('pg_dump', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (output.length < MAX_VERSION_OUTPUT) {
        output += chunk;
      }
    });
    let settled = false;
    child.on('error', () => {
      if (!settled) {
        settled = true;
        reject(new DumpFailedError('pg_dump', null));
      }
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new DumpFailedError('pg_dump', code));
      }
    });
  });
}
