import { focusManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** Milliseconds from `now` to the next local midnight; at least 1. */
export function msUntilNextLocalMidnight(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return Math.max(1, midnight - now.getTime());
}

/** The current time, refreshed at local midnight and whenever the app regains focus; steady otherwise. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
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
  }, []);

  return now;
}
