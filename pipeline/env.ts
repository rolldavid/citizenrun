import { EnvError, createLogger, parseEnv } from '@citizenrun/shared';
import type { LogLevel, Logger } from '@citizenrun/shared';
import { z } from 'zod';

export { EnvError };

// Every raw value has a maximum length.
const MAX_VALUE_LENGTH = 512;

const requiredValue = z.string().min(1).max(MAX_VALUE_LENGTH);

const httpUrl = requiredValue.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
});

/**
 * The pipeline's environment (PIPE-env). It has no database URL and no media, backups or legal
 * bucket (INV-14): the pipeline holds only the keys of its home bucket.
 */
export const PipelineEnvSchema = z.object({
  DATA_BUCKET: requiredValue,
  DATA_ENDPOINT: httpUrl,
  DATA_REGION: requiredValue,
  DATA_ACCESS_KEY_ID: requiredValue,
  DATA_SECRET_ACCESS_KEY: requiredValue,
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PIPELINE_RUN_ID: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,40}$/)
    .optional(),
  CI: z.string().max(MAX_VALUE_LENGTH).optional(),
  FEC_API_KEY: z.string().max(MAX_VALUE_LENGTH).optional(),
});

export type PipelineEnv = Readonly<{
  DATA_BUCKET: string;
  DATA_ENDPOINT: string;
  DATA_REGION: string;
  DATA_ACCESS_KEY_ID: string;
  DATA_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
  LOG_LEVEL: LogLevel;
  PIPELINE_RUN_ID: string | null;
  FEC_API_KEY: string | null;
  /** True only when CI is `true` (GitHub Actions); only the fetcher reads it. */
  isCi: boolean;
}>;

/**
 * Parses the pipeline's environment. An empty value counts as unset. Throws EnvError naming each
 * bad variable, never a value. While FEC_API_KEY (OI-datagov-key) is unset it logs one
 * `env.input_missing` line, which names the variable and never holds a value (D-416).
 * `source` defaults to the process environment, read only here.
 */
export function loadEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
  log?: Logger,
): PipelineEnv {
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') {
      values[name] = value;
    }
  }
  const parsed = parseEnv(PipelineEnvSchema, values);
  const env: PipelineEnv = Object.freeze({
    DATA_BUCKET: parsed.DATA_BUCKET,
    DATA_ENDPOINT: parsed.DATA_ENDPOINT,
    DATA_REGION: parsed.DATA_REGION,
    DATA_ACCESS_KEY_ID: parsed.DATA_ACCESS_KEY_ID,
    DATA_SECRET_ACCESS_KEY: parsed.DATA_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: parsed.S3_FORCE_PATH_STYLE,
    LOG_LEVEL: parsed.LOG_LEVEL,
    PIPELINE_RUN_ID: parsed.PIPELINE_RUN_ID ?? null,
    FEC_API_KEY: parsed.FEC_API_KEY ?? null,
    isCi: parsed.CI === 'true',
  });
  if (env.FEC_API_KEY === null) {
    const logger = log ?? createLogger({ service: 'pipeline', level: env.LOG_LEVEL });
    logger.warn('env.input_missing', { variable: 'FEC_API_KEY', ownerInput: 'OI-datagov-key' });
  }
  return env;
}
