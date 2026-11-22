import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import type { CORSRule, S3Client } from '@aws-sdk/client-s3';

function errorName(err: unknown): string | null {
  return err instanceof Error ? err.name : null;
}

function httpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('$metadata' in err)) {
    return null;
  }
  const metadata: unknown = err.$metadata;
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) {
    return null;
  }
  return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : null;
}

function isNotFound(err: unknown): boolean {
  return errorName(err) === 'NotFound' || httpStatus(err) === 404;
}

/**
 * Creates `bucket` when it does not exist (an existing one is not an error), then applies `cors`
 * when given. Resolves with nothing; rethrows any other failure of the store.
 */
export async function ensureBucket(
  client: S3Client,
  bucket: string,
  options?: { cors?: { CORSRules: readonly CORSRule[] } },
): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (createErr) {
      if (errorName(createErr) !== 'BucketAlreadyOwnedByYou') {
        throw createErr;
      }
    }
  }
  if (options?.cors !== undefined) {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [...options.cors.CORSRules] },
      }),
    );
  }
}
