import { useEffect, useId } from 'react';

import type { HeadModule, ThemeColorProps, TitleProps } from '@/platform/head/types';

export type HeadFakeCall = { op: 'themeColor'; color: string } | { op: 'title'; title: string };

const calls: HeadFakeCall[] = [];
/** The mounted ThemeColor components in mount order; the last one is the tag a browser would keep. */
const mountedColors = new Map<string, string>();
/** The mounted Title components in mount order; the last one is the title a browser would show. */
const mountedTitles = new Map<string, string>();

function ThemeColor({ color }: ThemeColorProps): null {
  const id = useId();

  useEffect(() => {
    calls.push({ op: 'themeColor', color });
    mountedColors.set(id, color);
    return () => {
      mountedColors.delete(id);
    };
  }, [id, color]);

  return null;
}

function Title({ children }: TitleProps): null {
  const id = useId();

  useEffect(() => {
    calls.push({ op: 'title', title: children });
    mountedTitles.set(id, children);
    return () => {
      mountedTitles.delete(id);
    };
  }, [id, children]);

  return null;
}

export const head: HeadModule = { ThemeColor, Title };

export const headFake = {
  calls: calls as readonly HeadFakeCall[],
  /** The color of the last mounted ThemeColor, or null when none is mounted. */
  themeColor: (): string | null => [...mountedColors.values()].at(-1) ?? null,
  /** The text of the last mounted Title, or null when none is mounted. */
  title: (): string | null => [...mountedTitles.values()].at(-1) ?? null,
  reset: (): void => {
    calls.length = 0;
    mountedColors.clear();
    mountedTitles.clear();
  },
};
