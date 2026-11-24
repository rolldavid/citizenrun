import { useEffect, useId } from 'react';

import type { HeadModule, ThemeColorProps } from '@/platform/head/types';

export type HeadFakeCall = { op: 'themeColor'; color: string };

const calls: HeadFakeCall[] = [];
/** The mounted ThemeColor components in mount order; the last one is the tag a browser would keep. */
const mounted = new Map<string, string>();

function ThemeColor({ color }: ThemeColorProps): null {
  const id = useId();

  useEffect(() => {
    calls.push({ op: 'themeColor', color });
    mounted.set(id, color);
    return () => {
      mounted.delete(id);
    };
  }, [id, color]);

  return null;
}

export const head: HeadModule = { ThemeColor };

export const headFake = {
  calls: calls as readonly HeadFakeCall[],
  /** The color of the last mounted ThemeColor, or null when none is mounted. */
  themeColor: (): string | null => [...mounted.values()].at(-1) ?? null,
  reset: (): void => {
    calls.length = 0;
    mounted.clear();
  },
};
