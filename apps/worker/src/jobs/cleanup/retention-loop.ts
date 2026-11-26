import { RetryableJobError } from '../types.ts';

/** The most rows one retention statement deletes or updates. */
export const RETENTION_BATCH_MAX = 10_000; // J-cleanup.retention

/** What a retention loop needs from its job: the shutdown signal and the heartbeat. */
export type LoopControl = { signal: AbortSignal; touch(): Promise<void> };

/**
 * Calls `step` until it affects no row; each call is one statement committed on its own; touch
 * after each; throws RetryableJobError('shutdown') when the signal is aborted before a call.
 * Returns the total rows.
 */
export async function runBatches(
  step: () => Promise<number>,
  control: LoopControl,
): Promise<number> {
  let total = 0;
  for (;;) {
    if (control.signal.aborted) {
      throw new RetryableJobError('shutdown');
    }
    const rows = await step();
    await control.touch();
    total += rows;
    if (rows === 0) {
      return total;
    }
  }
}
