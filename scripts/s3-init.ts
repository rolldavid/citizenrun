// Bucket creation and CORS for any S3 endpoint:
//   tsx scripts/s3-init.ts --endpoint <url> --region <region> --bucket <name>[,<name>...]
//     [--cors-origins <origin>[,<origin>...]] [--path-style]
// The keys come from S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, never from arguments.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { createS3Client, ensureBucket } from '@citizenrun/shared/storage';
import { mediaCorsRules } from './lib/cors.ts';

export type InitOptions = {
  endpoint: string;
  region: string;
  buckets: string[];
  corsOrigins: string[] | null;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

const USAGE =
  'tsx scripts/s3-init.ts --endpoint <url> --region <region> --bucket <name>[,<name>...] [--cors-origins <origin>[,<origin>...]] [--path-style]';

/** A command-line mistake; the script prints one usage line and exits 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** A CORS read-back that differs from the rules just set. */
export class CorsMismatchError extends Error {
  override name = 'CorsMismatchError';
}

const VALUE_FLAGS = ['--endpoint', '--region', '--bucket', '--cors-origins'] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

function isValueFlag(flag: string): flag is ValueFlag {
  return (VALUE_FLAGS as readonly string[]).includes(flag);
}

function list(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Parses the command line and the two key variables; throws UsageError naming what is missing. */
export function parseInitArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): InitOptions {
  const values = new Map<ValueFlag, string>();
  let forcePathStyle = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (flag === '--path-style') {
      forcePathStyle = true;
      continue;
    }
    if (!isValueFlag(flag)) {
      throw new UsageError(`unknown argument ${flag.startsWith('--') ? flag : 'given'}`);
    }
    if (values.has(flag)) {
      throw new UsageError(`${flag} is given twice`);
    }
    index += 1;
    const value = argv[index];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new UsageError(`${flag} needs a value`);
    }
    values.set(flag, value);
  }
  const endpoint = values.get('--endpoint');
  if (endpoint === undefined) {
    throw new UsageError('--endpoint is required');
  }
  const region = values.get('--region');
  if (region === undefined) {
    throw new UsageError('--region is required');
  }
  const bucketList = values.get('--bucket');
  const buckets = bucketList === undefined ? [] : list(bucketList);
  if (buckets.length === 0) {
    throw new UsageError('--bucket is required');
  }
  const originList = values.get('--cors-origins');
  const corsOrigins = originList === undefined ? null : list(originList);
  if (corsOrigins?.length === 0) {
    throw new UsageError('--cors-origins needs at least one origin');
  }
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  if (accessKeyId === undefined || accessKeyId === '') {
    throw new UsageError('S3_ACCESS_KEY_ID is not set');
  }
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (secretAccessKey === undefined || secretAccessKey === '') {
    throw new UsageError('S3_SECRET_ACCESS_KEY is not set');
  }
  return {
    endpoint,
    region,
    buckets,
    corsOrigins,
    forcePathStyle,
    accessKeyId,
    secretAccessKey,
  };
}

type Rule = {
  AllowedOrigins?: readonly string[] | undefined;
  AllowedMethods?: readonly string[] | undefined;
  AllowedHeaders?: readonly string[] | undefined;
  ExposeHeaders?: readonly string[] | undefined;
  MaxAgeSeconds?: number | undefined;
};

/** CORS rules as comparable JSON: the five fields, each list sorted, the rules sorted. */
function canonical(rules: readonly Rule[]): string {
  const sorted = (items: readonly string[] | undefined): string[] => [...(items ?? [])].sort();
  return JSON.stringify(
    rules
      .map((rule) =>
        JSON.stringify({
          AllowedOrigins: sorted(rule.AllowedOrigins),
          AllowedMethods: sorted(rule.AllowedMethods),
          AllowedHeaders: sorted(rule.AllowedHeaders),
          ExposeHeaders: sorted(rule.ExposeHeaders),
          MaxAgeSeconds: rule.MaxAgeSeconds ?? null,
        }),
      )
      .sort(),
  );
}

/**
 * Creates each bucket that is missing, in order; with `corsOrigins`, sets the media CORS rule on
 * each named bucket and reads it back. Throws CorsMismatchError when the read-back differs.
 */
export async function initBuckets(client: S3Client, options: InitOptions): Promise<void> {
  for (const bucket of options.buckets) {
    await ensureBucket(client, bucket);
  }
  if (options.corsOrigins === null) {
    return;
  }
  const rules = mediaCorsRules(options.corsOrigins);
  for (const bucket of options.buckets) {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: rules.CORSRules },
      }),
    );
    const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    if (canonical(current.CORSRules ?? []) !== canonical(rules.CORSRules)) {
      throw new CorsMismatchError(`the CORS rules read back from ${bucket} differ`);
    }
  }
}

/** Runs the script; resolves with the exit code: 0 done, 1 a store error, 2 a usage error. */
export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
): Promise<number> {
  let options: InitOptions;
  try {
    options = parseInitArgs(argv, env);
  } catch (error) {
    if (error instanceof UsageError) {
      out(`usage: ${error.message}; ${USAGE}`);
      return 2;
    }
    throw error;
  }
  const client = createS3Client({
    endpoint: options.endpoint,
    region: options.region,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    forcePathStyle: options.forcePathStyle,
  });
  try {
    for (const bucket of options.buckets) {
      try {
        await initBuckets(client, { ...options, buckets: [bucket] });
      } catch (error) {
        out(`s3-init ${bucket} fail ${error instanceof Error ? error.name : 'error'}`);
        return 1;
      }
      out(`s3-init ${bucket} ok`);
    }
  } finally {
    client.destroy();
  }
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env, (line) => {
    console.log(line);
  });
}
