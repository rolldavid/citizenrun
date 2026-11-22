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
 * variables, never their values. The package's one reader of `process.env`.
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
