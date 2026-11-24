import type { ReactNode } from 'react';

// CARD-primitives (D-270): the only props a canvas element takes. A template cannot pass another.

export type SvgProps = {
  width: number | string;
  height: number | string;
  viewBox: string;
  children?: ReactNode;
};
/** A group. Transforms are strings only; `clipPath` is `'url(#id)'`, for the hello card alone. */
export type GProps = { transform?: string; fill?: string; clipPath?: string; children?: ReactNode };
/** `fill` is `'none'` or a color passed in. */
export type RectProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  transform?: string;
};
export type CircleProps = { cx: number; cy: number; r: number; fill: string };
export type PathProps = { d: string; fill: string; fillRule?: 'nonzero' | 'evenodd' };
export type TextProps = {
  x: number;
  y: number;
  fontFamily: string;
  fontWeight?: string;
  fontSize: number;
  fill: string;
  letterSpacing?: number;
  textAnchor?: 'start' | 'middle' | 'end';
  children: string;
};
export type ImageProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  href: string;
  preserveAspectRatio: 'xMidYMid slice' | 'xMidYMid meet';
};
export type FontFace = 'regular' | 'medium' | 'bold' | 'mono';
export type FontAttrs = { fontFamily: string; fontWeight?: string };

// The six names no card uses. A gradient takes exact numbers, never percentages (D-270).
export type DefsProps = { children: ReactNode };
export type LinearGradientProps = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  children: ReactNode;
};
export type StopProps = { offset: number; stopColor: string };
export type ClipPathProps = { id: string; children: ReactNode };
export type MaskProps = { id: string; children: ReactNode };
export type TSpanProps = { x?: number; y?: number; children: string };
