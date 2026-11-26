import { useSyncExternalStore } from 'react';

import type { SessionPresence } from '@/platform/session';

const DEFAULT_PRESENCE: SessionPresence = 'unknown';

let presence: SessionPresence = DEFAULT_PRESENCE;
const listeners = new Set<() => void>();

/** Whether a session exists, as the whole app sees it; 'unknown' until set. */
export function getSessionPresence(): SessionPresence {
  return presence;
}

export function setSessionPresence(next: SessionPresence): void {
  if (next === presence) {
    return;
  }
  presence = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeSessionPresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSessionPresence(): SessionPresence {
  return useSyncExternalStore(subscribeSessionPresence, getSessionPresence, getSessionPresence);
}

/** Restores 'unknown'. Called by tests. */
export function resetSessionPresence(): void {
  setSessionPresence(DEFAULT_PRESENCE);
}
