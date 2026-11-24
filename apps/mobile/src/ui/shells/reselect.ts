import { useEffect, useRef } from 'react';

import type { NavItemId } from './app-shell';

/** The listeners of each nav item. An entry is made for one subscription, so it leaves alone. */
const listeners = new Map<NavItemId, Set<() => void>>();

/** MO-tab-restore: tells the screens of a tab that its nav item was chosen again. */
export function emitReselect(item: NavItemId): void {
  const entries = listeners.get(item);
  if (entries === undefined) return;
  // A copy: a listener may unsubscribe, or subscribe another, while the round runs.
  for (const entry of [...entries]) entry();
}

/** Calls listener on every reselect of item; the returned function unsubscribes. */
export function subscribeReselect(item: NavItemId, listener: () => void): () => void {
  const entry = (): void => {
    listener();
  };
  const entries = listeners.get(item) ?? new Set<() => void>();
  listeners.set(item, entries);
  entries.add(entry);
  return () => {
    entries.delete(entry);
    if (entries.size === 0 && listeners.get(item) === entries) listeners.delete(item);
  };
}

/** Subscribes while mounted; item null subscribes to nothing. */
export function useOnReselect(item: NavItemId | null, listener: () => void): void {
  const latest = useRef(listener);

  useEffect(() => {
    latest.current = listener;
  }, [listener]);

  useEffect(() => {
    if (item === null) return undefined;
    return subscribeReselect(item, () => {
      latest.current();
    });
  }, [item]);
}
