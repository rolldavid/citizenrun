import { createHash } from 'node:crypto';
import { createReadStream, rmSync } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Logger } from '@citizenrun/shared';
import { abortReason, DumpFailedError } from './dump.ts';
import type { pgDumpVersion, runDump, verifyDump } from './dump.ts';
import { encryptFile, publicKeyFingerprint } from './envelope.ts';
import type { BackupEnv } from './env.ts';
import type { readDatabaseFacts } from './facts.ts';
import { backupObjectKeys, backupStamp, buildManifest } from './manifest.ts';
import { countDumpStamps, pruneDumps, pruneReplay } from './prune.ts';
import { uploadMultipart } from './upload.ts';

/** The job's own time limit ran out (D-144). */
export class BackupTimeoutError extends Error {
  override readonly name = 'BackupTimeoutError';

  constructor() {
    super('backup timed out');
  }
}

/** Everything a run needs, passed in so the steps are tested without a process or a network. */
export type BackupDeps = {
  readonly env: BackupEnv;
  readonly s3: S3Client;
  readonly log: Logger;
  readonly now: () => Date;
  readonly workDir: string;
  readonly runDump: typeof runDump;
  readonly verifyDump: typeof verifyDump;
  readonly pgDumpVersion: typeof pgDumpVersion;
  readonly readDatabaseFacts: typeof readDatabaseFacts;
  readonly timeoutMs?: number;
};

export const REPLAY_KEEP_DAYS = 35; // OPS-replay-log

type Step = 'dump' | 'verify' | 'facts' | 'encrypt' | 'upload' | 'manifest' | 'prune';

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

// The error's constructor name: a failure's message can hold values, so the class is all that is logged.
function errorClassOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name: unknown = error.constructor.name;
    if (typeof name === 'string' && ERROR_CLASS_PATTERN.test(name)) {
      return name;
    }
  }
  return 'Error';
}

// Settles with `work`, or rejects as soon as `signal` aborts, so the time limit holds for a step
// whose callee takes no signal. A step abandoned this way is never awaited again.
function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      work.catch(() => undefined);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('step failed'));
      },
    );
  });
}

/**
 * The backup entry's handler for an uncaught exception or an unhandled rejection (D-807, D-828):
 * one `backup.failed` line with `reason: "crash"`, the error's class and `source`, then the work
 * folder removed, since it may hold the plaintext dump, and `exit(1)`. Node's crash text is never
 * printed.
 */
export function backupCrashHandler(
  log: Logger,
  workDir: string,
  source: 'exception' | 'rejection',
  exit: (code: number) => void,
): (error: unknown) => void {
  return (error) => {
    try {
      log.error('backup.failed', { reason: 'crash', source, errorClass: errorClassOf(error) });
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Nothing more can be reported; the exit code still says the run failed.
    } finally {
      exit(1);
    }
  };
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('expected bytes');
    }
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * Runs the backup steps (OPS-backup-job): dump, verify, gather facts, encrypt and delete the
 * plaintext, upload and check the size, write the manifest, prune dumps and replay entries.
 * Resolves to the exit code: 0 on success, 1 on failure, 2 when its own time limit ran out. Only
 * the step, the reason and the error class are logged, never a message or a tool's output.
 */
export async function runBackup(deps: BackupDeps): Promise<0 | 1 | 2> {
  const { env, s3, log, workDir } = deps;
  const bucket = env.backups.bucket;
  const timeoutMs = deps.timeoutMs ?? env.timeoutSeconds * 1000;
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => {
    controller.abort(new BackupTimeoutError());
  }, timeoutMs);

  let step: Step = 'dump';
  const begin = (next: Step): void => {
    step = next;
    if (signal.aborted) {
      throw abortReason(signal);
    }
  };

  try {
    begin('dump');
    const started = deps.now();
    const stamp = backupStamp(started);
    const { dumpKey, manifestKey } = backupObjectKeys(stamp);
    // A crashed run's leftover plaintext must not linger.
    await untilAborted(signal, rm(workDir, { recursive: true, force: true }));
    await untilAborted(signal, mkdir(workDir, { recursive: true, mode: 0o700 }));
    const dumpFile = join(workDir, `${stamp}.dump`);
    const encryptedFile = join(workDir, `${stamp}.dump.enc`);
    await untilAborted(signal, deps.runDump(env.databaseUrl, dumpFile, signal));

    begin('verify');
    await untilAborted(signal, deps.verifyDump(dumpFile));

    begin('facts');
    const facts = await untilAborted(signal, deps.readDatabaseFacts(env.databaseUrl));
    const dumpVersion = await untilAborted(signal, deps.pgDumpVersion());

    begin('encrypt');
    const plainBytes = (await untilAborted(signal, stat(dumpFile))).size;
    await untilAborted(signal, encryptFile(dumpFile, encryptedFile, env.publicKeyPem));
    // The plaintext goes before anything is uploaded.
    await untilAborted(signal, unlink(dumpFile));
    const encryptedBytes = (await untilAborted(signal, stat(encryptedFile))).size;
    const encryptedSha256 = await untilAborted(signal, sha256Of(encryptedFile));

    begin('upload');
    // Raced as well: the time limit holds even when the store ignores the signal (D-828).
    await untilAborted(signal, uploadMultipart(s3, bucket, dumpKey, encryptedFile, { signal }));
    const head = await untilAborted(
      signal,
      s3.send(new HeadObjectCommand({ Bucket: bucket, Key: dumpKey }), { abortSignal: signal }),
    );
    if (head.ContentLength !== encryptedBytes) {
      throw new Error('uploaded size differs');
    }

    begin('manifest');
    const manifest = buildManifest({
      createdAt: started.toISOString(),
      environment: env.appEnv,
      objectKey: dumpKey,
      plainBytes,
      encryptedBytes,
      encryptedSha256,
      publicKeyFingerprint: publicKeyFingerprint(env.publicKeyPem),
      pgDumpVersion: dumpVersion,
      serverVersion: facts.serverVersion,
      migrationHead: facts.migrationHead,
      tableEstimates: facts.tableEstimates,
      durationMs: deps.now().getTime() - started.getTime(),
    });
    await untilAborted(
      signal,
      s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: manifestKey,
          Body: JSON.stringify(manifest),
          ContentType: 'application/json',
        }),
        { abortSignal: signal },
      ),
    );

    begin('prune');
    await untilAborted(signal, pruneDumps(s3, bucket, env.keep));
    const kept = await untilAborted(signal, countDumpStamps(s3, bucket));
    await untilAborted(signal, pruneReplay(s3, bucket, deps.now(), REPLAY_KEEP_DAYS));

    log.info('backup.done', {
      bytes: encryptedBytes,
      durationMs: deps.now().getTime() - started.getTime(),
      kept,
    });
    return 0;
  } catch (error) {
    const reason: unknown = signal.aborted ? signal.reason : null;
    if (error instanceof BackupTimeoutError || reason instanceof BackupTimeoutError) {
      log.error('backup.failed', { reason: 'timeout', step });
      return 2;
    }
    log.error('backup.failed', {
      reason: 'error',
      step,
      errorClass: errorClassOf(error),
      ...(error instanceof DumpFailedError ? { exitCode: error.exitCode } : {}),
    });
    return 1;
  } finally {
    clearTimeout(timer);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
