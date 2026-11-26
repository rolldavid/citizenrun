import { describe, expect, it } from 'vitest';
import { RetryableJobError } from '../types.ts';
import { RETENTION_BATCH_MAX, runBatches } from './retention-loop.ts';

// A step that answers the given row counts in order, then 0, and counts its calls.
function scriptedStep(answers: readonly number[]): { step: () => Promise<number>; calls: number } {
  const state = {
    calls: 0,
    step: (): Promise<number> => {
      const rows = answers[state.calls] ?? 0;
      state.calls += 1;
      return Promise.resolve(rows);
    },
  };
  return state;
}

describe('runBatches', () => {
  it('repeats until a statement affects nothing', async () => {
    const scripted = scriptedStep([10_000, 10_000, 3, 0]);
    let touches = 0;
    const total = await runBatches(scripted.step, {
      signal: new AbortController().signal,
      touch: () => {
        touches += 1;
        return Promise.resolve();
      },
    });
    expect(total).toBe(20_003);
    expect(scripted.calls).toBe(4);
    expect(touches).toBe(4);
  });

  it('stops when the signal aborts', async () => {
    const abort = new AbortController();
    const scripted = scriptedStep([10_000, 10_000, 3, 0]);
    const run = runBatches(scripted.step, {
      signal: abort.signal,
      touch: () => {
        abort.abort();
        return Promise.resolve();
      },
    });
    await expect(run).rejects.toBeInstanceOf(RetryableJobError);
    await expect(run).rejects.toMatchObject({ reason: 'shutdown' });
    expect(scripted.calls).toBe(1);
  });

  it('makes no call when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const scripted = scriptedStep([5]);
    await expect(
      runBatches(scripted.step, { signal: abort.signal, touch: () => Promise.resolve() }),
    ).rejects.toMatchObject({ reason: 'shutdown' });
    expect(scripted.calls).toBe(0);
  });

  it('an empty first statement ends the loop with no rows', async () => {
    const scripted = scriptedStep([]);
    const total = await runBatches(scripted.step, {
      signal: new AbortController().signal,
      touch: () => Promise.resolve(),
    });
    expect(total).toBe(0);
    expect(scripted.calls).toBe(1);
  });

  it('a batch holds at most ten thousand rows', () => {
    expect(RETENTION_BATCH_MAX).toBe(10_000);
  });
});
