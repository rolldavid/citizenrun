// The bucket smoke test of D-100 spike 5 (D-248, D-249), run against the media bucket under the
// prefix smoke/ and deleting every key it wrote:
//   pnpm exec tsx scripts/smoke-bucket.ts
// It reads MEDIA_*, S3_FORCE_PATH_STYLE and PUBLIC_URL from the environment. Presigned URLs are
// secrets: no URL, key, field value or credential is ever printed.
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { newId } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { z } from 'zod';

export const SMOKE_PREFIX = 'smoke/';
/** 36 hours (D-249). */
export const PRESIGNED_GET_SECONDS = 129600;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const UPLOAD_BYTES = 1024;
const OVERSIZE_BYTES = 2049;

/** The start of the 12-hour window `now` falls in: every URL signed in it is byte-identical (D-249). */
export function signingDateFor(now: Date): Date {
  return new Date(Math.floor(now.getTime() / TWELVE_HOURS_MS) * TWELVE_HOURS_MS);
}

/** A presigned GET URL valid for 36 hours from the start of the current 12-hour window. */
export function presignedGet(
  client: S3Client,
  bucket: string,
  key: string,
  now: Date,
): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGNED_GET_SECONDS,
    signingDate: signingDateFor(now),
  });
}

export type SmokeResult = { id: 1 | 2 | 3 | 4 | 5; name: string; pass: boolean; detail: string };

export type SmokeOptions = {
  client: S3Client;
  bucket: string;
  origin: string;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  newKey: () => string;
};

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) {
    return null;
  }
  const metadata: unknown = error.$metadata;
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) {
    return null;
  }
  return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : null;
}

function isNotFound(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) ||
    errorStatus(error) === 404
  );
}

/** The object's size in bytes, or null when it does not exist; any other failure throws. */
async function objectSize(client: S3Client, bucket: string, key: string): Promise<number | null> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

/** The message a failed request or store call leaves in a detail: never a URL, key or value. */
function failureDetail(error: unknown): string {
  const status = errorStatus(error);
  return status === null ? 'request failed' : `store status ${String(status)}`;
}

type PostAttempt = { status: number; size: number | null };

/** Presigns a POST for `key` with the smoke policy and posts `bytes` with the given content type. */
async function postUpload(
  options: SmokeOptions,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<PostAttempt> {
  const { url, fields } = await createPresignedPost(options.client, {
    Bucket: options.bucket,
    Key: key,
    Conditions: [
      ['eq', '$Content-Type', 'image/jpeg'],
      ['content-length-range', 1, 2048],
    ],
    Fields: { 'Content-Type': 'image/jpeg' },
    Expires: 300,
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, name === 'Content-Type' ? contentType : value);
  }
  form.append('file', new Blob([bytes], { type: contentType }), 'smoke.jpg');
  const response = await options.fetch(url, { method: 'POST', body: form });
  await response.arrayBuffer();
  return {
    status: response.status,
    size: await objectSize(options.client, options.bucket, key),
  };
}

function presence(size: number | null): string {
  return size === null ? 'no object' : 'object present';
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Runs the five checks of D-100 spike 5 in order and deletes every key it wrote, even after a
 * failure. A detail is a status code, `object present` or `no object`.
 */
export async function runSmoke(options: SmokeOptions): Promise<SmokeResult[]> {
  const written: string[] = [];
  const results: SmokeResult[] = [];
  const nextKey = (): string => {
    const key = options.newKey();
    written.push(key);
    return key;
  };
  const record = async (
    id: SmokeResult['id'],
    name: string,
    check: () => Promise<{ pass: boolean; detail: string }>,
  ): Promise<void> => {
    try {
      results.push({ id, name, ...(await check()) });
    } catch (error) {
      results.push({ id, name, pass: false, detail: failureDetail(error) });
    }
  };
  try {
    const body = new Uint8Array(randomBytes(UPLOAD_BYTES));
    const uploadedKey = nextKey();
    let uploaded = false;
    await record(1, 'post-upload', async () => {
      const attempt = await postUpload(options, uploadedKey, body, 'image/jpeg');
      uploaded = is2xx(attempt.status) && attempt.size === UPLOAD_BYTES;
      return {
        pass: uploaded,
        detail: `status ${String(attempt.status)}, ${presence(attempt.size)}`,
      };
    });
    await record(2, 'post-oversize', async () => {
      const attempt = await postUpload(
        options,
        nextKey(),
        new Uint8Array(randomBytes(OVERSIZE_BYTES)),
        'image/jpeg',
      );
      return {
        pass: is4xx(attempt.status) && attempt.size === null,
        detail: `status ${String(attempt.status)}, ${presence(attempt.size)}`,
      };
    });
    await record(3, 'post-wrong-type', async () => {
      const attempt = await postUpload(options, nextKey(), body, 'image/png');
      return {
        pass: is4xx(attempt.status) && attempt.size === null,
        detail: `status ${String(attempt.status)}, ${presence(attempt.size)}`,
      };
    });
    let firstUrl: string | null = null;
    await record(4, 'get-stable', async () => {
      const first = await presignedGet(options.client, options.bucket, uploadedKey, options.now());
      firstUrl = first;
      await options.sleep(2000);
      const second = await presignedGet(options.client, options.bucket, uploadedKey, options.now());
      const response = await options.fetch(first);
      const got = new Uint8Array(await response.arrayBuffer());
      const identical = first === second;
      const pass = identical && response.status === 200 && sameBytes(got, body);
      return {
        pass,
        detail: `status ${String(response.status)}${identical ? '' : ', urls differ'}${
          response.status === 200 && !sameBytes(got, body) ? ', body differs' : ''
        }`,
      };
    });
    await record(5, 'cors-preflight', async () => {
      const objectUrl =
        firstUrl ??
        (await presignedGet(options.client, options.bucket, uploadedKey, options.now()));
      const response = await options.fetch(objectUrl.split('?')[0] ?? objectUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: options.origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      await response.arrayBuffer();
      const allowed = response.headers.get('access-control-allow-origin');
      return {
        pass: is2xx(response.status) && allowed === options.origin,
        detail: `status ${String(response.status)}${
          allowed === options.origin ? '' : ', origin not allowed'
        }`,
      };
    });
  } finally {
    for (const key of written) {
      try {
        await options.client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
      } catch {
        // A key that cannot be deleted is left; the smoke prefix keeps it apart from user media.
      }
    }
  }
  return results;
}

const SmokeEnvSchema = z.object({
  MEDIA_BUCKET: z.string().min(1),
  MEDIA_ENDPOINT: z.string().min(1),
  MEDIA_REGION: z.string().min(1),
  MEDIA_ACCESS_KEY_ID: z.string().min(1),
  MEDIA_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  PUBLIC_URL: z.string().min(1),
});

export type SmokeEnv = z.infer<typeof SmokeEnvSchema>;

/** The smoke's variables, or the names of those missing or invalid (never their values). */
export function parseSmokeEnv(
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; value: SmokeEnv } | { ok: false; names: string[] } {
  const parsed = SmokeEnvSchema.safeParse(env);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    names: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'a variable')))],
  };
}

/** Prints one line per check; resolves 0 when all five pass, 1 otherwise, 2 for a missing variable. */
export async function main(
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
): Promise<number> {
  const parsed = parseSmokeEnv(env);
  if (!parsed.ok) {
    out(`smoke-bucket: missing or invalid ${parsed.names.join(', ')}`);
    return 2;
  }
  const config = parsed.value;
  const client = createS3Client({
    endpoint: config.MEDIA_ENDPOINT,
    region: config.MEDIA_REGION,
    accessKeyId: config.MEDIA_ACCESS_KEY_ID,
    secretAccessKey: config.MEDIA_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE === 'true',
  });
  try {
    const results = await runSmoke({
      client,
      bucket: config.MEDIA_BUCKET,
      origin: config.PUBLIC_URL,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
      now: () => new Date(),
      sleep: (ms) =>
        new Promise((resolvePromise) => {
          setTimeout(resolvePromise, ms);
        }),
      newKey: () => `${SMOKE_PREFIX}${newId()}.jpg`,
    });
    for (const result of results) {
      out(
        result.pass
          ? `smoke ${String(result.id)} ${result.name} pass`
          : `smoke ${String(result.id)} ${result.name} fail ${result.detail}`,
      );
    }
    return results.length === 5 && results.every((result) => result.pass) ? 0 : 1;
  } finally {
    client.destroy();
  }
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.env, (line) => {
    console.log(line);
  });
}
