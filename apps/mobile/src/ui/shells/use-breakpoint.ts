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
  /** The width right of the rail: the window less its side insets at compact, the window less the
   *  icon rail at medium, and the capped content less the labeled rail at expanded. */
  mainWidth: number;
  /** The feed column: as wide as `mainWidth` at compact, size.feedColumn at most beside the rail, and
   *  at expanded what the right column leaves of it. */
  feedColumnWidth: number;
  /** The width of a 4:5 canvas in the feed column; never under size.canvasMinCell at expanded. */
  canvasWidth: number;
  /** Expanded only. */
  showsRightColumn: boolean;
};

/** The left and right safe-area insets: what the system keeps at the sides of the window. */
export type SideInsets = { left: number; right: number };

/** The share of the free window height a canvas may take at expanded, so its action row stays on screen. */
const EXPANDED_CANVAS_SHARE = 0.8;

const NO_SIDE_INSETS: SideInsets = { left: 0, right: 0 };

const TopBarHeightContext = createContext(0);
const SideInsetsContext = createContext<SideInsets>(NO_SIDE_INSETS);

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
  sideInsets: SideInsets,
): Pick<Layout, 'mainWidth' | 'feedColumnWidth' | 'canvasWidth'> {
  switch (breakpoint) {
    case 'compact': {
      // A full-bleed canvas reaches the safe edges, not the glass under a side inset.
      const safeWidth = Math.max(0, width - sideInsets.left - sideInsets.right);
      return { mainWidth: safeWidth, feedColumnWidth: safeWidth, canvasWidth: safeWidth };
    }
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
      // A window shorter than its fixed chrome leaves no free height: the canvas stops shrinking at
      // the narrowest width a canvas is drawn at, and the page scrolls.
      const canvasWidth = Math.min(
        feedColumnWidth,
        Math.max(size.canvasMinCell, EXPANDED_CANVAS_SHARE * freeHeight),
      );
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
  /** Default none. */
  sideInsets?: SideInsets;
}): Layout {
  const { width, height, fontScale, topBarHeight, sideInsets = NO_SIDE_INSETS } = input;
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
    ...columnsFor(breakpoint, width, height - topBarHeight - size.desktopCanvasReserve, sideInsets),
    showsRightColumn: breakpoint === 'expanded',
  };
}

/**
 * The window's layout (DS-breakpoint). The only call of useWindowDimensions in the app. It reads no
 * inset itself: the side insets are those of the nearest `SideInsetsProvider`, and none without one.
 */
export function useBreakpoint(): Layout {
  const { width, height, fontScale } = useWindowDimensions();
  const topBarHeight = useContext(TopBarHeightContext);
  const sideInsets = useContext(SideInsetsContext);
  return useMemo(
    () => layoutFor({ width, height, fontScale, topBarHeight, sideInsets }),
    [width, height, fontScale, topBarHeight, sideInsets],
  );
}

/** The channel for topBarHeight: useBreakpoint() reads the nearest provider's height, and 0 when there is none. */
export function TopBarHeightProvider(props: { height: number; children: ReactNode }): JSX.Element {
  return createElement(TopBarHeightContext.Provider, { value: props.height }, props.children);
}

/**
 * The channel for the side insets: C-Screen, which reads them, gives them to every `useBreakpoint()`
 * under it, so a full-bleed child is as wide as the safe area.
 */
export function SideInsetsProvider(props: {
  left: number;
  right: number;
  children: ReactNode;
}): JSX.Element {
  const { left, right, children } = props;
  const value = useMemo<SideInsets>(() => ({ left, right }), [left, right]);
  return createElement(SideInsetsContext.Provider, { value }, children);
}
