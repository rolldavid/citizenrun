import type { Tx } from '../client.ts';

/** One seed step: runs inside its own transaction, idempotently, at the run's `anchor` minute. */
export type SeedStep = { name: string; run(tx: Tx, ctx: { anchor: Date }): Promise<void> };

/** A seed step found the database unfit to seed. The message names what is missing, never a value. */
export class SeedError extends Error {
  override readonly name = 'SeedError';
}
