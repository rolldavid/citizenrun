import { focusManager } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Context } from 'react';

/** A fixed time for useNow; provided only by the screen fixture registry, never by the app. */
export const NowOverrideContext: Context<Date | null> = createContext<Date | null>(null);

/** Milliseconds from `now` to the next local midnight; at least 1. */
export function msUntilNextLocalMidnight(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return Math.max(1, midnight - now.getTime());
}

/**
 * The current time, refreshed at local midnight and whenever the app regains focus; steady otherwise.
 * Under a NowOverrideContext value it answers that value and sets no timer.
 */
export function useNow(): Date {
  const override = useContext(NowOverrideContext);
  const [now, setNow] = useState(() => override ?? new Date());

  useEffect(() => {
    if (override !== null) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msUntilNextLocalMidnight(new Date()));
    };
    schedule();
    const unsubscribe = focusManager.subscribe((focused) => {
      if (focused) setNow(new Date());
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [override]);

  return override ?? now;
}
