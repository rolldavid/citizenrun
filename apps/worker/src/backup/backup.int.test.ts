import { spawn } from 'node:child_process';
import { createHash, generateKeyPair } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  getTestBucket,
  getTestDatabaseUrl,
  getTestObject,
  listTestKeys,
  putTestObject,
  resetStorage,
} from '@citizenrun/db/testing';
import { createLogger } from '@citizenrun/shared';
import pg from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgDumpVersion, runDump, verifyDump } from './dump.ts';
import { decryptFile, publicKeyFingerprint } from './envelope.ts';
import type { BackupEnv } from './env.ts';
import { readDatabaseFacts } from './facts.ts';
import { BackupManifestSchema } from './manifest.ts';
import { runBackup } from './run.ts';

const generate = promisify(generateKeyPair);

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const USAGE = 'usage: decrypt.ts --in <file.dump.enc> --out <file.dump> --key <private-key.pem>';
const HEARTBEAT_MARKER = 'OS_MARKER_backup_hb_7c21';
const BASE_TIME = Date.parse('2027-03-05T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

type Pair = { publicKey: string; privateKey: string };
type Outcome = { code: number; output: string; errors: string };

let first: Pair = { publicKey: '', privateKey: '' };
let second: Pair = { publicKey: '', privateKey: '' };
let dir = '';
let minute = 0;
let lines: string[] = [];

function rsaPair(): Promise<Pair> {
  return generate('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

// Runs a tool with an argument array and no shell; its output is kept for the assertions only.
function run(command: string, args: readonly string[], cwd = REPO_ROOT): Promise<Outcome> {
  return new Promise<Outcome>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, output, errors });
    });
  });
}

function stampOf(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function dumpKeys(stamp: string): [string, string] {
  const base = `pg/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp}`;
  return [`${base}.dump.enc`, `${base}.json`];
}

// Each case gets its own minute, so stamps never collide.
function nextNow(): Date {
  minute += 1;
  return new Date(BASE_TIME + minute * 60_000);
}

async function backup(options: {
  now: Date;
  keep?: number;
  databaseUrl?: string;
}): Promise<{ code: number; workDir: string }> {
  const { client, bucket } = await getTestBucket('backups');
  const env: BackupEnv = {
    appEnv: 'ci',
    logLevel: 'debug',
    databaseUrl: options.databaseUrl ?? getTestDatabaseUrl(),
    backups: {
      bucket,
      endpoint: 'http://fixture-endpoint.invalid:8333',
      region: 'fixture-region',
      accessKeyId: 'fixture-access-key',
      secretAccessKey: 'fixture-secret-key',
    },
    forcePathStyle: true,
    publicKeyPem: first.publicKey,
    keep: options.keep ?? 14,
    timeoutSeconds: 1800,
  };
  const workDir = join(dir, 'work');
  const code = await runBackup({
    env,
    s3: client,
    log: createLogger({
      service: 'worker',
      level: 'debug',
      sink: (line) => {
        lines.push(line);
      },
    }),
    now: () => options.now,
    workDir,
    runDump,
    verifyDump,
    pgDumpVersion,
    readDatabaseFacts,
  });
  return { code, workDir };
}

async function insertHeartbeat(): Promise<void> {
  const client = new pg.Client({ connectionString: getTestDatabaseUrl() });
  await client.connect();
  try {
    await client.query('insert into worker_heartbeats (worker, version) values ($1, $2)', [
      'backup-test',
      HEARTBEAT_MARKER,
    ]);
  } finally {
    await client.end();
  }
}

async function download(key: string, file: string): Promise<Buffer> {
  const bytes = await getTestObject('backups', key);
  if (bytes === null) {
    throw new Error('object missing');
  }
  const buffer = Buffer.from(bytes);
  await writeFile(file, buffer);
  return buffer;
}

beforeAll(async () => {
  const version = await pgDumpVersion().catch(() => '');
  if (!version.includes(' 17.')) {
    throw new Error('backup.int.test.ts needs pg_dump 17 first on PATH (postgresql-client-17)');
  }
  [first, second] = await Promise.all([rsaPair(), rsaPair()]);
}, 60_000);

beforeEach(async () => {
  await resetStorage();
  dir = await mkdtemp(join(tmpdir(), 'backup-int-'));
  lines = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the backup job against the local stack', () => {
  it('writes an encrypted dump and its manifest under pg/<YYYY>/<MM>/', async () => {
    await insertHeartbeat();
    const now = nextNow();
    const stamp = stampOf(now);
    const [dumpKey, manifestKey] = dumpKeys(stamp);

    const { code, workDir } = await backup({ now });

    expect(code).toBe(0);
    const keys = await listTestKeys('backups', '');
    expect(keys).toEqual([dumpKey, manifestKey].sort());
    expect(keys.some((key) => key.endsWith('.dump'))).toBe(false);
    const body = await download(dumpKey, join(dir, 'object.dump.enc'));
    const manifest = BackupManifestSchema.parse(
      JSON.parse(Buffer.from((await getTestObject('backups', manifestKey)) ?? []).toString('utf8')),
    );
    expect(manifest.objectKey).toBe(dumpKey);
    expect(manifest.environment).toBe('ci');
    expect(manifest.createdAt).toBe(now.toISOString());
    expect(manifest.encryptedBytes).toBe(body.length);
    expect(manifest.encryptedSha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(manifest.publicKeyFingerprint).toBe(publicKeyFingerprint(first.publicKey));
    expect(manifest.pgDumpVersion).toContain(' 17.');
    expect(manifest.serverVersion).toMatch(/^PostgreSQL /);
    expect(manifest.migrationHead).not.toBeNull();
    expect(manifest.tableEstimates).toHaveProperty('worker_heartbeats');
    expect(existsSync(workDir)).toBe(false);
    const done = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(done.find((line) => line.event === 'backup.done')).toMatchObject({
      bytes: body.length,
      kept: 1,
    });
  });

  it('the uploaded object is not readable as a pg_dump archive without the private key', async () => {
    await insertHeartbeat();
    const now = nextNow();
    expect((await backup({ now })).code).toBe(0);
    const file = join(dir, 'object.dump.enc');
    const body = await download(dumpKeys(stampOf(now))[0], file);

    const listed = await run('pg_restore', ['--list', file]);

    expect(listed.code).not.toBe(0);
    expect(body.includes(Buffer.from(HEARTBEAT_MARKER, 'utf8'))).toBe(false);
    expect(body.subarray(0, 8).toString('ascii')).toBe('DBENV01\n');
  });

  it('decrypts with the test key and lists with pg_restore', async () => {
    await insertHeartbeat();
    const now = nextNow();
    expect((await backup({ now })).code).toBe(0);
    const encrypted = join(dir, 'object.dump.enc');
    const restored = join(dir, 'object.dump');
    await download(dumpKeys(stampOf(now))[0], encrypted);

    await decryptFile(encrypted, restored, first.privateKey);
    const listed = await run('pg_restore', ['--list', restored]);

    expect(listed.code).toBe(0);
    expect(listed.output).toContain(' TABLE DATA ');
    expect(listed.output).toMatch(/TABLE DATA public worker_heartbeats /);
  });

  it('decrypt.ts restores the dump from the command line', { timeout: 60_000 }, async () => {
    await insertHeartbeat();
    const now = nextNow();
    expect((await backup({ now })).code).toBe(0);
    const encrypted = join(dir, 'object.dump.enc');
    await download(dumpKeys(stampOf(now))[0], encrypted);
    const firstKey = join(dir, 'first.key.pem');
    const secondKey = join(dir, 'second.key.pem');
    await writeFile(firstKey, first.privateKey, { mode: 0o600 });
    await writeFile(secondKey, second.privateKey, { mode: 0o600 });
    const decrypt = ['--filter', '@citizenrun/worker', 'exec', 'tsx', 'src/backup/decrypt.ts'];

    const restored = join(dir, 'restored.dump');
    const ok = await run('pnpm', [
      ...decrypt,
      '--in',
      encrypted,
      '--out',
      restored,
      '--key',
      firstKey,
    ]);
    expect(ok.code).toBe(0);
    expect(ok.errors).toMatch(/^decrypted \d+ bytes$/m);
    expect(ok.errors).not.toContain(firstKey);
    expect(ok.errors).not.toContain('PRIVATE KEY');
    expect((await run('pg_restore', ['--list', restored])).code).toBe(0);

    const existing = await run('pnpm', [
      ...decrypt,
      '--in',
      encrypted,
      '--out',
      restored,
      '--key',
      firstKey,
    ]);
    expect(existing.code).toBe(1);
    expect(existing.errors).toMatch(/^output exists$/m);

    const refused = join(dir, 'refused.dump');
    const wrong = await run('pnpm', [
      ...decrypt,
      '--in',
      encrypted,
      '--out',
      refused,
      '--key',
      secondKey,
    ]);
    expect(wrong.code).toBe(1);
    expect(wrong.errors).toMatch(/^wrapped key does not decrypt$/m);
    expect(wrong.errors).not.toContain(secondKey);
    expect(existsSync(refused)).toBe(false);
    expect(existsSync(`${refused}.partial`)).toBe(false);

    // pnpm's filtered exec reports any failing command as exit 1, so the usage exit code is read
    // from the same entry run by the worker's tsx directly.
    const missingIn = ['--out', join(dir, 'x.dump'), '--key', firstKey];
    const usage = await run('pnpm', [...decrypt, ...missingIn]);
    expect(usage.code).not.toBe(0);
    expect(usage.errors).toContain(USAGE);
    const direct = await run(TSX, ['src/backup/decrypt.ts', ...missingIn], WORKER_ROOT);
    expect(direct.code).toBe(2);
    expect(direct.errors).toBe(`${USAGE}\n`);
    const extra = await run(
      TSX,
      ['src/backup/decrypt.ts', ...missingIn, '--in', encrypted, '--force'],
      WORKER_ROOT,
    );
    expect(extra.code).toBe(2);
    expect(existsSync(join(dir, 'x.dump'))).toBe(false);
  });

  it('prunes to BACKUP_KEEP', async () => {
    const now = nextNow();
    const seeded: string[] = [];
    for (let day = 15; day >= 1; day -= 1) {
      const stamp = stampOf(new Date(now.getTime() - day * DAY_MS));
      seeded.push(stamp);
      for (const key of dumpKeys(stamp)) {
        await putTestObject('backups', key, new Uint8Array([1, 2, 3]), 'application/octet-stream');
      }
    }
    await putTestObject('backups', 'pg/README.txt', new Uint8Array([1]), 'text/plain');

    expect((await backup({ now, keep: 14 })).code).toBe(0);

    const keys = await listTestKeys('backups', 'pg/');
    const expected = [...seeded.slice(2), stampOf(now)].flatMap((stamp) => dumpKeys(stamp));
    expect(keys).toEqual([...expected, 'pg/README.txt'].sort());
    expect(keys).toHaveLength(29);
  });

  it('deletes replay objects older than 35 days and keeps those of 34', async () => {
    const now = nextNow();
    const dateBefore = (days: number): string =>
      new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
    const old = `replay/deletions/${dateBefore(36)}/x.json`;
    const recent = `replay/deletions/${dateBefore(34)}/y.json`;
    await putTestObject('backups', old, new Uint8Array([1]), 'application/json');
    await putTestObject('backups', recent, new Uint8Array([1]), 'application/json');

    expect((await backup({ now })).code).toBe(0);

    expect(await listTestKeys('backups', 'replay/')).toEqual([recent]);
  });

  it('exits non-zero and leaves nothing when the database is unreachable', async () => {
    const now = nextNow();
    const { code, workDir } = await backup({
      now,
      databaseUrl: 'postgresql://citizenrun:citizenrun@127.0.0.1:1/citizenrun',
    });
    expect(code).toBe(1);
    expect(existsSync(workDir)).toBe(false);
    expect(await listTestKeys('backups', '')).toEqual([]);
    const failed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === 'backup.failed');
    expect(failed).toMatchObject({ reason: 'error', step: 'dump', errorClass: 'DumpFailedError' });
    expect(lines.join('\n')).not.toContain('127.0.0.1:1');
  });
});
