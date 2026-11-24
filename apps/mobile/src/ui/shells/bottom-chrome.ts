import { useEffect, useId, useSyncExternalStore } from 'react';

/** The height each mounted reporter covers at the bottom edge, by reporter id. */
const heights = new Map<string, number>();
const subscribers = new Set<() => void>();

function notify(): void {
  for (const subscriber of [...subscribers]) subscriber();
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/** Records the height a reporter covers at the bottom edge. */
export function reportBottomChrome(id: string, height: number): void {
  if (heights.get(id) === height) return;
  heights.set(id, height);
  notify();
}

/** Forgets a reporter: it covers nothing from here on. */
export function clearBottomChrome(id: string): void {
  if (heights.delete(id)) notify();
}

/** The largest height reported now, 0 when nothing covers the bottom edge. */
export function bottomChromeHeight(): number {
  let largest = 0;
  for (const height of heights.values()) {
    largest = Math.max(largest, height);
  }
  return largest;
}

/** C-TabBar and C-Screen's footer report the height they cover at the bottom edge while mounted; 0 on unmount. */
export function useReportBottomChrome(height: number): void {
  const id = useId();

  useEffect(() => {
    reportBottomChrome(id, height);
  }, [id, height]);

  useEffect(
    () => () => {
      clearBottomChrome(id);
    },
    [id],
  );
}

/** The largest height reported now, 0 when nothing covers the bottom edge. */
export function useBottomChromeHeight(): number {
  return useSyncExternalStore(subscribe, bottomChromeHeight, bottomChromeHeight);
}
