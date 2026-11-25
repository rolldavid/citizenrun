import { createHash, generateKeyPair } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  CreateMultipartUploadCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { createLogger } from '@citizenrun/shared';
import { seededRandom } from '@citizenrun/shared/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DumpFailedError, DumpVerificationError } from './dump.ts';
import { loadBackupEnv } from './env.ts';
import type { BackupEnv } from './env.ts';
import type { DatabaseFacts } from './facts.ts';
import { BackupManifestSchema } from './manifest.ts';
import { backupCrashHandler, runBackup } from './run.ts';
import type { BackupDeps } from './run.ts';
import { createFakeS3 } from './testing/fake-s3.ts';
import type { FakeS3 } from './testing/fake-s3.ts';
import { ABORT_UPLOAD_LIMIT_MS } from './upload.ts';

const generate = promisify(generateKeyPair);

const DATABASE_URL = 'postgresql://app_backup:marker-password-3c9e@db.fixture.invalid:5432/fixture';
const SECRET_ACCESS_KEY = 'marker-secret-8a1f';
const ENDPOINT = 'https://store.fixture.invalid:8443';
const NOW = new Date('2027-03-05T08:00:04.123Z');
const DUMP_KEY = 'pg/2027/03/20270305T080004Z.dump.enc';
const MANIFEST_KEY = 'pg/2027/03/20270305T080004Z.json';
const PLAIN_BYTES = 4096;
const ENVELOPE_BYTES = 10 + 512 + 12 + PLAIN_BYTES + 16;

const FACTS: DatabaseFacts = {
  serverVersion: 'PostgreSQL 17.6 fixture',
  migrationHead: { hash: 'ab'.repeat(32), createdAt: 1_795_404_775_000 },
  tableEstimates: { worker_heartbeats: 1, 'pgboss.job': 0 },
};

type Hook = (command: unknown, options: { abortSignal?: AbortSignal } | undefined) => Promise<void>;

let publicKey = '';
let env: BackupEnv;
let parent = '';
let workDir = '';
let fake: FakeS3;
let events: string[];
let hooks: Map<string, Hook>;
let lines: string[];

function seededBytes(length: number, seed: number): Buffer {
  const random = seededRandom(seed);
  return Buffer.from(Array.from({ length }, () => Math.floor(random() * 256)));
}

// Records each command (a listing with its prefix) and runs the test's hook before the fake answers.
function client(): S3Client {
  const send = async (
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> => {
    const name = typeof command === 'object' && command !== null ? command.constructor.name : '';
    events.push(
      command instanceof ListObjectsV2Command ? `${name}:${command.input.Prefix ?? ''}` : name,
    );
    await hooks.get(name)?.(command, options);
    return fake.client.send(command as never, options as never);
  };
  // test double: implements send() for the commands the backup uses
  return { send } as unknown as S3Client;
}

function deps(overrides: Partial<BackupDeps> = {}): BackupDeps {
  return {
    env,
    s3: client(),
    log: createLogger({
      service: 'worker',
      level: 'debug',
      sink: (line) => {
        lines.push(line);
      },
      now: () => NOW,
    }),
    now: () => NOW,
    workDir,
    runDump: async (_url, outFile) => {
      events.push('dump');
      await writeFile(outFile, seededBytes(PLAIN_BYTES, 1));
    },
    verifyDump: () => {
      events.push('verify');
      return Promise.resolve({ tableDataEntries: 3 });
    },
    pgDumpVersion: () => {
      events.push('pgDumpVersion');
      return Promise.resolve('pg_dump (PostgreSQL) 17.6');
    },
    readDatabaseFacts: () => {
      events.push('facts');
      return Promise.resolve(FACTS);
    },
    ...overrides,
  };
}

function logged(): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
}

beforeAll(async () => {
  ({ publicKey } = await generate('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }));
  env = loadBackupEnv({
    APP_ENV: 'ci',
    DATABASE_URL,
    BACKUPS_BUCKET: 'fixture-backups',
    BACKUPS_ENDPOINT: ENDPOINT,
    BACKUPS_REGION: 'us-east-1',
    BACKUPS_ACCESS_KEY_ID: 'fixture-access-key',
    BACKUPS_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
    BACKUP_PUBLIC_KEY: publicKey,
  });
}, 60_000);

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'backup-run-test-'));
  workDir = join(parent, 'work');
  fake = createFakeS3();
  events = [];
  hooks = new Map();
  lines = [];
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(parent, { recursive: true, force: true });
});

describe('runBackup', () => {
  it('runs the steps in order and exits 0', async () => {
    expect(await runBackup(deps())).toBe(0);
    expect(events).toEqual([
      'dump',
      'verify',
      'facts',
      'pgDumpVersion',
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
      'HeadObjectCommand',
      'PutObjectCommand',
      'ListObjectsV2Command:pg/',
      'ListObjectsV2Command:pg/',
      'ListObjectsV2Command:replay/',
    ]);
    const done = logged().filter((line) => line.event === 'backup.done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ level: 'info', bytes: ENVELOPE_BYTES, durationMs: 0, kept: 1 });
    expect(logged().some((line) => line.event === 'backup.failed')).toBe(false);
    expect(existsSync(workDir)).toBe(false);
  });

  it('writes a manifest that describes the uploaded object', async () => {
    expect(await runBackup(deps())).toBe(0);
    const manifest = BackupManifestSchema.parse(
      JSON.parse(fake.objects.get(MANIFEST_KEY)?.body.toString('utf8') ?? 'null'),
    );
    expect(manifest).toMatchObject({
      createdAt: NOW.toISOString(),
      environment: 'ci',
      objectKey: DUMP_KEY,
      plainBytes: PLAIN_BYTES,
      encryptedBytes: ENVELOPE_BYTES,
      pgDumpVersion: 'pg_dump (PostgreSQL) 17.6',
      serverVersion: FACTS.serverVersion,
      migrationHead: FACTS.migrationHead,
      tableEstimates: FACTS.tableEstimates,
    });
    const body = fake.objects.get(DUMP_KEY)?.body ?? Buffer.alloc(0);
    expect(manifest.encryptedSha256).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('the plaintext dump is gone before the upload starts', async () => {
    let seen: string[] = [];
    hooks.set('CreateMultipartUploadCommand', async () => {
      seen = await readdir(workDir);
    });
    expect(await runBackup(deps())).toBe(0);
    expect(seen).toEqual(['20270305T080004Z.dump.enc']);
  });

  it('never uploads a plaintext dump', async () => {
    const bodies: Buffer[] = [];
    hooks.set('UploadPartCommand', (command) => {
      if (command instanceof UploadPartCommand && command.input.Body instanceof Uint8Array) {
        bodies.push(Buffer.from(command.input.Body));
      }
      return Promise.resolve();
    });
    expect(await runBackup(deps())).toBe(0);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.subarray(0, 8).toString('ascii')).toBe('DBENV01\n');
    }
    expect(fake.objects.get(DUMP_KEY)?.body.subarray(0, 8).toString('ascii')).toBe('DBENV01\n');
    expect([...fake.objects.keys()].sort()).toEqual([DUMP_KEY, MANIFEST_KEY]);
    expect(MANIFEST_KEY.endsWith('.json')).toBe(true);
    expect(() =>
      BackupManifestSchema.parse(JSON.parse(fake.objects.get(MANIFEST_KEY)?.body.toString() ?? '')),
    ).not.toThrow();
  });

  it('a failing dump exits 1 and leaves nothing behind', async () => {
    const code = await runBackup(
      deps({
        runDump: async (_url, outFile) => {
          await writeFile(outFile, seededBytes(100, 2));
          throw new DumpFailedError('pg_dump', 1);
        },
      }),
    );
    expect(code).toBe(1);
    const failed = logged().filter((line) => line.event === 'backup.failed');
    expect(failed).toHaveLength(1);
    const { time, ...rest } = failed[0] ?? {};
    expect(typeof time).toBe('string');
    expect(rest).toEqual({
      level: 'error',
      service: 'worker',
      event: 'backup.failed',
      reason: 'error',
      step: 'dump',
      errorClass: 'DumpFailedError',
      exitCode: 1,
    });
    expect(existsSync(workDir)).toBe(false);
    expect(fake.objects.size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('a dump that lists no table data is not uploaded', async () => {
    const code = await runBackup(
      deps({
        verifyDump: () => Promise.reject(new DumpVerificationError()),
      }),
    );
    expect(code).toBe(1);
    expect(logged().find((line) => line.event === 'backup.failed')).toMatchObject({
      reason: 'error',
      step: 'verify',
      errorClass: 'DumpVerificationError',
    });
    expect(fake.calls).toEqual([]);
    expect(existsSync(workDir)).toBe(false);
  });

  it('a failing facts query is reported as the facts step', async () => {
    const code = await runBackup(
      deps({ readDatabaseFacts: () => Promise.reject(new TypeError('marker-facts-11aa')) }),
    );
    expect(code).toBe(1);
    expect(logged().find((line) => line.event === 'backup.failed')).toMatchObject({
      step: 'facts',
      errorClass: 'TypeError',
    });
    expect(lines.join('\n')).not.toContain('marker-facts-11aa');
    expect(fake.calls).toEqual([]);
  });

  it('a size mismatch after upload fails the run', async () => {
    fake.headSize.set(DUMP_KEY, ENVELOPE_BYTES - 1);
    expect(await runBackup(deps())).toBe(1);
    expect(logged().find((line) => line.event === 'backup.failed')).toMatchObject({
      reason: 'error',
      step: 'upload',
    });
    expect(fake.calls).not.toContain('PutObjectCommand');
    expect(fake.calls).not.toContain('ListObjectsV2Command');
    expect(fake.calls).not.toContain('DeleteObjectCommand');
    expect(fake.objects.has(MANIFEST_KEY)).toBe(false);
  });

  it('a failing manifest write is reported as the manifest step and prunes nothing', async () => {
    fake.failOn('PutObjectCommand');
    expect(await runBackup(deps())).toBe(1);
    expect(logged().find((line) => line.event === 'backup.failed')).toMatchObject({
      step: 'manifest',
    });
    expect(fake.calls).not.toContain('ListObjectsV2Command');
  });

  it('its own timeout exits 2 and kills the dump', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const started = deferred();
    let dumpSignal: AbortSignal | null = null;
    const run = runBackup(
      deps({
        timeoutMs: 50,
        runDump: (_url, _outFile, signal) => {
          dumpSignal = signal;
          started.resolve();
          return waitForAbort(signal);
        },
      }),
    );
    await started.promise;
    await vi.advanceTimersByTimeAsync(50);
    expect(await run).toBe(2);
    expect(dumpSignal).not.toBeNull();
    expect((dumpSignal as AbortSignal | null)?.aborted).toBe(true);
    const failed = logged().filter((line) => line.event === 'backup.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: 'error', reason: 'timeout', step: 'dump' });
    expect(failed[0]).not.toHaveProperty('errorClass');
    expect(existsSync(workDir)).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('a timeout during the upload aborts the multipart upload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const uploading = deferred();
    hooks.set('UploadPartCommand', (_command, options) => {
      uploading.resolve();
      return waitForAbort(options?.abortSignal);
    });
    const run = runBackup(deps({ timeoutMs: 50 }));
    await uploading.promise;
    await vi.advanceTimersByTimeAsync(50);
    expect(await run).toBe(2);
    expect(fake.calls).toContain('AbortMultipartUploadCommand');
    expect(fake.calls).not.toContain('CompleteMultipartUploadCommand');
    expect(fake.objects.size).toBe(0);
    expect(logged().find((line) => line.event === 'backup.failed')).toMatchObject({
      reason: 'timeout',
      step: 'upload',
    });
    expect(existsSync(workDir)).toBe(false);
  });

  it('a store that stalls at the create still exits 2 on the time limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const creating = deferred();
    hooks.set('CreateMultipartUploadCommand', () => {
      creating.resolve();
      return new Promise<void>(() => undefined); // ignores the signal
    });
    const run = runBackup(deps({ timeoutMs: 300 }));
    await creating.promise;
    await vi.advanceTimersByTimeAsync(300);
    expect(await run).toBe(2);
    expect(logged().filter((line) => line.event === 'backup.failed')).toEqual([
      expect.objectContaining({ level: 'error', reason: 'timeout', step: 'upload' }),
    ]);
    expect(existsSync(workDir)).toBe(false);
  });

  it('a store that stalls at the cleanup abort still exits 2 on the time limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const uploading = deferred();
    hooks.set('UploadPartCommand', (_command, options) => {
      uploading.resolve();
      return waitForAbort(options?.abortSignal);
    });
    hooks.set('AbortMultipartUploadCommand', () => new Promise<void>(() => undefined));
    const run = runBackup(deps({ timeoutMs: 300 }));
    await uploading.promise;
    await vi.advanceTimersByTimeAsync(300);
    expect(await run).toBe(2);
    expect(events).toContain('AbortMultipartUploadCommand');
    expect(logged().filter((line) => line.event === 'backup.failed')).toEqual([
      expect.objectContaining({ level: 'error', reason: 'timeout', step: 'upload' }),
    ]);
    expect(existsSync(workDir)).toBe(false);
    // The abandoned upload gives up its abort and closes the file.
    await vi.advanceTimersByTimeAsync(ABORT_UPLOAD_LIMIT_MS);
  });

  it('a timeout during a step without a signal still exits 2', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reading = deferred();
    const code = runBackup(
      deps({
        timeoutMs: 50,
        readDatabaseFacts: () => {
          reading.resolve();
          return new Promise<DatabaseFacts>(() => undefined);
        },
      }),
    );
    await reading.promise;
    await vi.advanceTimersByTimeAsync(50);
    expect(await code).toBe(2);
    expect(logged().find((line) => line.event === 'backup.failed')).toMatchObject({
      reason: 'timeout',
      step: 'facts',
    });
    expect(fake.calls).toEqual([]);
  });

  it('the log lines carry no secret', async () => {
    expect(await runBackup(deps())).toBe(0);
    fake.failOn('UploadPartCommand', new Error(`refused ${DATABASE_URL} ${SECRET_ACCESS_KEY}`));
    expect(await runBackup(deps())).toBe(1);
    expect(
      await runBackup(
        deps({
          runDump: () => Promise.reject(new DumpFailedError('pg_dump', 2)),
        }),
      ),
    ).toBe(1);
    const output = lines.join('\n');
    const keyBody = publicKey
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('-----'))
      .join('');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(output).not.toContain(DATABASE_URL);
    expect(output).not.toContain('marker-password-3c9e');
    expect(output).not.toContain(SECRET_ACCESS_KEY);
    expect(output).not.toContain(ENDPOINT);
    expect(output).not.toContain(keyBody.slice(0, 64));
    for (const line of publicKey.split('\n').filter((part) => part.length > 20)) {
      expect(output).not.toContain(line);
    }
  });

  it('a leftover work directory is removed first', async () => {
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, 'old.dump'), 'leftover plaintext');
    let leftoverDuringRun = true;
    let mode = 0;
    const code = await runBackup(
      deps({
        runDump: async (_url, outFile) => {
          leftoverDuringRun = existsSync(join(workDir, 'old.dump'));
          mode = (await stat(workDir)).mode & 0o777;
          await writeFile(outFile, seededBytes(PLAIN_BYTES, 3));
        },
      }),
    );
    expect(code).toBe(0);
    expect(leftoverDuringRun).toBe(false);
    expect(mode).toBe(0o700);
    expect(existsSync(join(workDir, 'old.dump'))).toBe(false);
  });

  it('prunes the bucket to BACKUP_KEEP after a run', async () => {
    for (let day = 1; day <= 14; day += 1) {
      const stamp = `202702${String(day).padStart(2, '0')}T080000Z`;
      for (const suffix of ['.dump.enc', '.json']) {
        fake.objects.set(`pg/2027/02/${stamp}${suffix}`, {
          body: Buffer.from('fixture'),
          lastModified: new Date(0),
        });
      }
    }
    expect(await runBackup(deps())).toBe(0);
    expect(fake.objects.has('pg/2027/02/20270201T080000Z.dump.enc')).toBe(false);
    expect(fake.objects.has('pg/2027/02/20270202T080000Z.dump.enc')).toBe(true);
    expect(fake.objects.has(DUMP_KEY)).toBe(true);
    expect(logged().find((line) => line.event === 'backup.done')).toMatchObject({ kept: 14 });
  });

  it('the multipart upload is created with the dump key', async () => {
    let key: string | undefined;
    hooks.set('CreateMultipartUploadCommand', (command) => {
      if (command instanceof CreateMultipartUploadCommand) {
        key = command.input.Key;
      }
      return Promise.resolve();
    });
    expect(await runBackup(deps())).toBe(0);
    expect(key).toBe(DUMP_KEY);
  });
});

describe('backupCrashHandler', () => {
  it('logs backup.failed with the class only, removes the work folder and exits 1', async () => {
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, 'left.dump'), seededBytes(16, 9));
    const exits: number[] = [];
    const log = deps().log;
    const handler = backupCrashHandler(log, workDir, 'exception', (code) => {
      exits.push(code);
    });
    const error = new Error(`Connection terminated ${DATABASE_URL}`);
    handler(error);
    expect(exits).toEqual([1]);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'backup.failed',
        reason: 'crash',
        source: 'exception',
        errorClass: 'Error',
      }),
    ]);
    expect(lines.join('\n')).not.toContain('marker-password-3c9e');
    expect(existsSync(workDir)).toBe(false);
  });
});
