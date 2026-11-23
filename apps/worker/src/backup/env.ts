import { createPublicKey } from 'node:crypto';
import { EnvError, parseEnv } from '@citizenrun/shared';
import { z } from 'zod';

/** The backup job's validated environment (OPS-backup-job). */
export type BackupEnv = {
  readonly appEnv: 'local' | 'ci' | 'staging' | 'production';
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly databaseUrl: string;
  readonly backups: {
    readonly bucket: string;
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly forcePathStyle: boolean;
  readonly publicKeyPem: string;
  readonly keep: number;
  readonly timeoutSeconds: number;
};

/** A refused backup environment. It names the variables and never holds a value. */
export class BackupEnvError extends Error {
  override readonly name = 'BackupEnvError';
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`invalid backup environment: ${variables.join(', ')}`);
    this.variables = variables;
  }
}

const MAX_URL_LENGTH = 2048;
const RSA_MODULUS_BITS = 4096; // OPS-backup-envelope
const PUBLIC_KEY_HEADER = '-----BEGIN PUBLIC KEY-----';

function integerString(min: number, max: number, fallback: string): z.ZodType<number> {
  return z
    .string()
    .max(6)
    .regex(/^[0-9]+$/)
    .default(fallback)
    .transform((value) => Number(value))
    .pipe(z.int().min(min).max(max));
}

const httpUrl = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  });

export const BackupEnvSchema = z.object({
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1)
    .max(MAX_URL_LENGTH)
    .regex(/^postgres(ql)?:\/\//),
  BACKUPS_BUCKET: z.string().min(1).max(255),
  BACKUPS_ENDPOINT: httpUrl,
  BACKUPS_REGION: z.string().min(1).max(64),
  BACKUPS_ACCESS_KEY_ID: z.string().min(1).max(256),
  BACKUPS_SECRET_ACCESS_KEY: z.string().min(1).max(512),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Required in every APP_ENV: the job has no mode without it.
  BACKUP_PUBLIC_KEY: z
    .string()
    .min(1)
    .max(16384)
    .refine((value) => value.includes(PUBLIC_KEY_HEADER)),
  BACKUP_KEEP: integerString(1, 365, '14'), // D-028
  BACKUP_TIMEOUT_SECONDS: integerString(60, 7200, '1800'), // D-144
});

function isRsa4096(pem: string): boolean {
  try {
    const key = createPublicKey(pem);
    return (
      key.asymmetricKeyType === 'rsa' &&
      key.asymmetricKeyDetails?.modulusLength === RSA_MODULUS_BITS
    );
  } catch {
    return false;
  }
}

/**
 * Validates the backup job's environment. Throws BackupEnvError naming each refused variable: any
 * variable of the legal bucket (D-025), a value the schema refuses, or a public key that is not RSA
 * 4096.
 */
export function loadBackupEnv(source: Readonly<Record<string, string | undefined>>): BackupEnv {
  const legal = Object.keys(source)
    .filter((name) => name.startsWith('LEGAL_'))
    .sort();
  if (legal.length > 0) {
    throw new BackupEnvError(legal);
  }
  let parsed: z.infer<typeof BackupEnvSchema>;
  try {
    parsed = parseEnv(BackupEnvSchema, source);
  } catch (error) {
    if (error instanceof EnvError) {
      throw new BackupEnvError(error.variables);
    }
    throw error;
  }
  if (!isRsa4096(parsed.BACKUP_PUBLIC_KEY)) {
    throw new BackupEnvError(['BACKUP_PUBLIC_KEY']);
  }
  return Object.freeze({
    appEnv: parsed.APP_ENV,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    backups: Object.freeze({
      bucket: parsed.BACKUPS_BUCKET,
      endpoint: parsed.BACKUPS_ENDPOINT,
      region: parsed.BACKUPS_REGION,
      accessKeyId: parsed.BACKUPS_ACCESS_KEY_ID,
      secretAccessKey: parsed.BACKUPS_SECRET_ACCESS_KEY,
    }),
    forcePathStyle: parsed.S3_FORCE_PATH_STYLE,
    publicKeyPem: parsed.BACKUP_PUBLIC_KEY,
    keep: parsed.BACKUP_KEEP,
    timeoutSeconds: parsed.BACKUP_TIMEOUT_SECONDS,
  });
}

/** The backup job's environment from the process: the folder's one reader of process.env. */
export function loadBackupEnvFromProcess(): BackupEnv {
  return loadBackupEnv(process.env);
}
