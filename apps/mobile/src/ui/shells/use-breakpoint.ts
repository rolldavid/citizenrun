import { assertNever } from '@citizenrun/shared';
import { createContext, createElement, useContext, useMemo } from 'react';
import type { JSX, ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { breakpoints, gutter, size, textScale } from '@/ui/tokens';

export type Breakpoint = 'compact' | 'medium' | 'expanded';

export type Layout = {
  breakpoint: Breakpoint;
  /** Window width in points. */
  width: number;
  /** Window height in points. */
  height: number;
  /** The system font scale; 1 on the web. */
  fontScale: number;
  /** width < gutter.narrowBelow */
  isNarrow: boolean;
  /** isNarrow && fontScale >= textScale.tightFrom */
  isTight: boolean;
  /** gutter.narrow when isNarrow, else gutter.regular. */
  gutter: number;
  /** The width right of the rail: the window at compact, less the icon rail at medium, and the capped
   *  content less the labeled rail at expanded. */
  mainWidth: number;
  /** The feed column: the window at compact, size.feedColumn at most beside the rail, and at expanded
   *  what the right column leaves of it. */
  feedColumnWidth: number;
  /** The width of a 4:5 canvas in the feed column. */
  canvasWidth: number;
  /** Expanded only. */
  showsRightColumn: boolean;
};

/** The share of the free window height a canvas may take at expanded, so its action row stays on screen. */
const EXPANDED_CANVAS_SHARE = 0.8;

const TopBarHeightContext = createContext(0);

/** Pure. Compact below breakpoints.medium, medium below breakpoints.expanded, expanded from there up. */
export function breakpointFor(width: number): Breakpoint {
  if (width < breakpoints.medium) return 'compact';
  if (width < breakpoints.expanded) return 'medium';
  return 'expanded';
}

function columnsFor(
  breakpoint: Breakpoint,
  width: number,
  freeHeight: number,
): Pick<Layout, 'mainWidth' | 'feedColumnWidth' | 'canvasWidth'> {
  switch (breakpoint) {
    case 'compact':
      return { mainWidth: width, feedColumnWidth: width, canvasWidth: width };
    case 'medium': {
      const mainWidth = width - size.railIcon;
      const feedColumnWidth = Math.min(size.feedColumn, mainWidth);
      return { mainWidth, feedColumnWidth, canvasWidth: feedColumnWidth };
    }
    case 'expanded': {
      const mainWidth = Math.min(width, size.contentMax) - size.rail;
      const feedColumnWidth = Math.min(
        size.feedColumn,
        mainWidth - (size.columnGap * 2 + size.rightColumn),
      );
      const canvasWidth = Math.min(feedColumnWidth, EXPANDED_CANVAS_SHARE * freeHeight);
      return { mainWidth, feedColumnWidth, canvasWidth };
    }
    default:
      return assertNever(breakpoint);
  }
}

/** Pure; the whole of the hook's arithmetic, so it can be tested without rendering. */
export function layoutFor(input: {
  width: number;
  height: number;
  fontScale: number;
  topBarHeight: number;
}): Layout {
  const { width, height, fontScale, topBarHeight } = input;
  const breakpoint = breakpointFor(width);
  const isNarrow = width < gutter.narrowBelow;
  return {
    breakpoint,
    width,
    height,
    fontScale,
    isNarrow,
    isTight: isNarrow && fontScale >= textScale.tightFrom,
    gutter: isNarrow ? gutter.narrow : gutter.regular,
    ...columnsFor(breakpoint, width, height - topBarHeight - size.desktopCanvasReserve),
    showsRightColumn: breakpoint === 'expanded',
  };
}

/** The window's layout (DS-breakpoint). The only call of useWindowDimensions in the app. */
export function useBreakpoint(): Layout {
  const { width, height, fontScale } = useWindowDimensions();
  const topBarHeight = useContext(TopBarHeightContext);
  return useMemo(
    () => layoutFor({ width, height, fontScale, topBarHeight }),
    [width, height, fontScale, topBarHeight],
  );
}

/** The channel for topBarHeight: useBreakpoint() reads the nearest provider's height, and 0 when there is none. */
export function TopBarHeightProvider(props: { height: number; children: ReactNode }): JSX.Element {
  return createElement(TopBarHeightContext.Provider, { value: props.height }, props.children);
}
