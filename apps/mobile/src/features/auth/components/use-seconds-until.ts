import { useEffect, useState } from 'react';

const SECOND_MS = 1000;

/** The whole seconds from `now` to `instant`, rounded up, and never under 0. */
function secondsBetween(now: number, instant: string): number {
  const left = Date.parse(instant) - now;
  return Number.isFinite(left) && left > 0 ? Math.ceil(left / SECOND_MS) : 0;
}

/**
 * The whole seconds from now to `instant`, at least 0, counted down once a second until it reaches
 * 0. What a countdown shows, and nothing a decision is made from.
 */
export function useSecondsUntil(instant: string): number {
  const [seconds, setSeconds] = useState(() => secondsBetween(Date.now(), instant));

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    // Reads the clock; at 0 there is nothing left to count.
    const read = (): void => {
      const left = secondsBetween(Date.now(), instant);
      setSeconds(left);
      if (left === 0) {
        stop();
      }
    };
    timer = setInterval(read, SECOND_MS);
    // A new instant starts its own count at once.
    read();
    return stop;
  }, [instant]);

  return seconds;
}
