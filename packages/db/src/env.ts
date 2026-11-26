import { parseEnv } from '@citizenrun/shared';
import type { LogLevel } from '@citizenrun/shared';
import { z } from 'zod';

export type AppEnv = 'local' | 'ci' | 'staging' | 'production';

export type DbEnv = { databaseUrl: string; appEnv: AppEnv; logLevel: LogLevel };

const APP_ENVS = ['local', 'ci', 'staging', 'production'] as const satisfies readonly AppEnv[];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const satisfies readonly LogLevel[];

const isPostgresUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
};

const DbEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).max(2048).refine(isPostgresUrl),
  APP_ENV: z.enum(APP_ENVS).default('local'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

/**
 * The database package's environment: `DATABASE_URL` (a `postgres:` or `postgresql:` URL),
 * `APP_ENV` (default `local`) and `LOG_LEVEL` (default `info`). Throws EnvError naming the bad
 * variables, never their values. With loadSeedMediaEnv, the package's only reader of `process.env`.
 */
export function loadDbEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): DbEnv {
  const env = parseEnv(DbEnvSchema, source);
  return Object.freeze({
    databaseUrl: env.DATABASE_URL,
    appEnv: env.APP_ENV,
    logLevel: env.LOG_LEVEL,
  });
}

/** The seed runner's media bucket settings: where the placeholder images go. */
export type SeedMediaEnv = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const SeedMediaEnvSchema = z.object({
  MEDIA_BUCKET: z.string().min(1).max(63),
  MEDIA_ENDPOINT: z.string().min(1).max(2048).refine(isHttpUrl),
  MEDIA_REGION: z.string().min(1).max(64),
  MEDIA_ACCESS_KEY_ID: z.string().min(1).max(256),
  MEDIA_SECRET_ACCESS_KEY: z.string().min(1).max(256),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

/**
 * The seed runner's media bucket: `MEDIA_BUCKET`, `MEDIA_ENDPOINT` (an `http:` or `https:` URL),
 * `MEDIA_REGION`, `MEDIA_ACCESS_KEY_ID` and `MEDIA_SECRET_ACCESS_KEY`, all required, and
 * `S3_FORCE_PATH_STYLE` (`true` or `false`, default `false`). Throws EnvError naming the bad
 * variables, never their values.
 */
export function loadSeedMediaEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): SeedMediaEnv {
  const env = parseEnv(SeedMediaEnvSchema, source);
  return Object.freeze({
    bucket: env.MEDIA_BUCKET,
    endpoint: env.MEDIA_ENDPOINT,
    region: env.MEDIA_REGION,
    accessKeyId: env.MEDIA_ACCESS_KEY_ID,
    secretAccessKey: env.MEDIA_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
