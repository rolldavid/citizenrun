import type { ErrorCode } from '@citizenrun/shared';

export type OptimisticAction = 'follow' | 'unfollow' | 'bookmark' | 'unbookmark';
export type OptimisticFailure = {
  readonly seq: number;
  readonly action: OptimisticAction;
  readonly code: ErrorCode;
};

type Listener = (failure: OptimisticFailure) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** Tells every subscriber that an optimistic toggle was put back. */
export function reportOptimisticFailure(input: {
  action: OptimisticAction;
  code: ErrorCode;
}): void {
  seq += 1;
  const failure: OptimisticFailure = { seq, action: input.action, code: input.code };
  for (const listener of [...listeners]) {
    try {
      listener(failure);
    } catch {
      // A listener that throws is dropped, so one broken subscriber cannot stop the others.
      listeners.delete(listener);
    }
  }
}

/** Subscribes to failures; returns the unsubscribe function. */
export function subscribeOptimisticFailures(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
