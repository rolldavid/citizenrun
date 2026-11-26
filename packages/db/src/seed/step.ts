import type { S3Client } from '@aws-sdk/client-s3';
import type { Tx } from '../client.ts';

/** The media bucket a seed step writes its placeholder images to. */
export type SeedMedia = { client: S3Client; bucket: string };

/** What every step receives: the run's `anchor` minute and the media bucket. */
export type SeedContext = { anchor: Date; media: SeedMedia };

/** One seed step: runs inside its own transaction, idempotently, at the run's `anchor` minute. */
export type SeedStep = { name: string; run(tx: Tx, ctx: SeedContext): Promise<void> };

/** A seed step found the database unfit to seed. The message names what is missing, never a value. */
export class SeedError extends Error {
  override readonly name = 'SeedError';
}
