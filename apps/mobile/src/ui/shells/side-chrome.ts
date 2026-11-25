import { useEffect, useId, useSyncExternalStore } from 'react';

/** The width each mounted reporter covers at the left edge of the content row, by reporter id. */
const widths = new Map<string, number>();
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

/** Records the width a reporter covers at the left edge of the content row. */
export function reportSideChrome(id: string, width: number): void {
  if (widths.get(id) === width) return;
  widths.set(id, width);
  notify();
}

/** Forgets a reporter: it covers nothing from here on. */
export function clearSideChrome(id: string): void {
  if (widths.delete(id)) notify();
}

/** The largest width reported now, 0 when no rail stands beside the content. */
export function sideChromeWidth(): number {
  let largest = 0;
  for (const width of widths.values()) {
    largest = Math.max(largest, width);
  }
  return largest;
}

/** C-AppShell reports the width of the rail it draws while mounted, 0 where it draws none. */
export function useReportSideChrome(width: number): void {
  const id = useId();

  useEffect(() => {
    reportSideChrome(id, width);
  }, [id, width]);

  useEffect(
    () => () => {
      clearSideChrome(id);
    },
    [id],
  );
}

/** The largest width reported now, 0 when no rail stands beside the content. */
export function useSideChromeWidth(): number {
  return useSyncExternalStore(subscribe, sideChromeWidth, sideChromeWidth);
}
