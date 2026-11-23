import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { BackupEnvError, loadBackupEnv } from './env.ts';

const generate = promisify(generateKeyPair);

let rsa4096 = '';
let rsa2048 = '';
let ed25519 = '';

beforeAll(async () => {
  const rsa = (modulusLength: number): Promise<string> =>
    generate('rsa', {
      modulusLength,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }).then((pair) => pair.publicKey);
  const edwards = generate('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).then((pair) => pair.publicKey);
  [rsa4096, rsa2048, ed25519] = await Promise.all([rsa(4096), rsa(2048), edwards]);
}, 60_000);

function required(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: 'ci',
    DATABASE_URL: 'postgresql://app_backup:fixture-password@localhost:5432/fixture',
    BACKUPS_BUCKET: 'fixture-backups',
    BACKUPS_ENDPOINT: 'http://localhost:8333',
    BACKUPS_REGION: 'us-east-1',
    BACKUPS_ACCESS_KEY_ID: 'fixture-access-key',
    BACKUPS_SECRET_ACCESS_KEY: 'fixture-secret-key',
    BACKUP_PUBLIC_KEY: rsa4096,
    ...overrides,
  };
}

function refusal(source: Record<string, string | undefined>): BackupEnvError {
  try {
    loadBackupEnv(source);
  } catch (error) {
    if (error instanceof BackupEnvError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadBackupEnv to throw');
}

describe('loadBackupEnv', () => {
  it('parses the variables with their defaults', () => {
    const env = loadBackupEnv(required({ UNRELATED_VARIABLE: 'ignored' }));
    expect(env.keep).toBe(14);
    expect(env.timeoutSeconds).toBe(1800);
    expect(env.forcePathStyle).toBe(false);
    expect(env.logLevel).toBe('info');
    expect(env.appEnv).toBe('ci');
    expect(env.backups).toEqual({
      bucket: 'fixture-backups',
      endpoint: 'http://localhost:8333',
      region: 'us-east-1',
      accessKeyId: 'fixture-access-key',
      secretAccessKey: 'fixture-secret-key',
    });
    expect(env.publicKeyPem).toBe(rsa4096);
  });

  it('reads the optional values when they are set', () => {
    const env = loadBackupEnv(
      required({
        LOG_LEVEL: 'warn',
        S3_FORCE_PATH_STYLE: 'true',
        BACKUP_KEEP: '365',
        BACKUP_TIMEOUT_SECONDS: '60',
      }),
    );
    expect(env.logLevel).toBe('warn');
    expect(env.forcePathStyle).toBe(true);
    expect(env.keep).toBe(365);
    expect(env.timeoutSeconds).toBe(60);
  });

  it('refuses a LEGAL_ variable and names it without its value', () => {
    const error = refusal(required({ LEGAL_BUCKET: 'marker-legal-7f3a' }));
    expect(error.variables).toEqual(['LEGAL_BUCKET']);
    expect(error.message).toContain('LEGAL_BUCKET');
    expect(error.message).not.toContain('marker-legal-7f3a');
  });

  it('a missing BACKUP_PUBLIC_KEY is reported by name in local and ci', () => {
    for (const appEnv of ['local', 'ci']) {
      const error = refusal(required({ APP_ENV: appEnv, BACKUP_PUBLIC_KEY: undefined }));
      expect(error.variables).toEqual(['BACKUP_PUBLIC_KEY']);
      expect(error.message).toContain('BACKUP_PUBLIC_KEY');
    }
  });

  it('refuses a key that is not RSA 4096', () => {
    for (const key of [rsa2048, ed25519]) {
      const error = refusal(required({ BACKUP_PUBLIC_KEY: key }));
      expect(error.variables).toEqual(['BACKUP_PUBLIC_KEY']);
    }
  });

  it('refuses text that only looks like a public key', () => {
    const error = refusal(
      required({
        BACKUP_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nmarker-key-0b1d\n-----END PUBLIC KEY-----',
      }),
    );
    expect(error.variables).toEqual(['BACKUP_PUBLIC_KEY']);
    expect(error.message).not.toContain('marker-key-0b1d');
  });

  it('a malformed secret is reported by name without its value', () => {
    const error = refusal(
      required({ BACKUPS_SECRET_ACCESS_KEY: '', DATABASE_URL: 'mysql://marker-db-91c2' }),
    );
    expect(error.variables).toEqual(['BACKUPS_SECRET_ACCESS_KEY', 'DATABASE_URL']);
    expect(error.message).toContain('BACKUPS_SECRET_ACCESS_KEY');
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain('marker-db-91c2');
    for (const value of Object.values(required())) {
      if (value !== undefined) {
        expect(error.message).not.toContain(value);
      }
    }
  });

  it('BACKUP_KEEP outside 1 to 365 is refused', () => {
    for (const keep of ['0', '366', 'abc']) {
      const error = refusal(required({ BACKUP_KEEP: keep }));
      expect(error.variables).toEqual(['BACKUP_KEEP']);
    }
  });

  it('BACKUP_TIMEOUT_SECONDS outside 60 to 7200 is refused', () => {
    for (const seconds of ['59', '7201', '1.5']) {
      const error = refusal(required({ BACKUP_TIMEOUT_SECONDS: seconds }));
      expect(error.variables).toEqual(['BACKUP_TIMEOUT_SECONDS']);
    }
  });

  it('refuses an endpoint that is not http or https', () => {
    const error = refusal(required({ BACKUPS_ENDPOINT: 'ftp://localhost:8333' }));
    expect(error.variables).toEqual(['BACKUPS_ENDPOINT']);
  });
});
