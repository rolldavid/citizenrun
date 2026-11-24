import { createElement } from 'react';
import type { JSX } from 'react';
import { FONT_CSS } from '@citizenrun/shared';
import type {
  CircleProps,
  ClipPathProps,
  DefsProps,
  FontAttrs,
  FontFace,
  GProps,
  ImageProps,
  LinearGradientProps,
  MaskProps,
  PathProps,
  RectProps,
  StopProps,
  SvgProps,
  TextProps,
  TSpanProps,
} from './types.ts';

// CARD-primitives (D-270): each name is its plain SVG element, for the web, the tests and the server.

/** The root of a canvas. It passes on whatever `svgRootProps()` adds. */
export function Svg(props: SvgProps): JSX.Element {
  return createElement('svg', props);
}

export function G(props: GProps): JSX.Element {
  return createElement('g', props);
}

export function Path(props: PathProps): JSX.Element {
  return createElement('path', props);
}

export function Rect(props: RectProps): JSX.Element {
  return createElement('rect', props);
}

export function Circle(props: CircleProps): JSX.Element {
  return createElement('circle', props);
}

export function Defs(props: DefsProps): JSX.Element {
  return createElement('defs', props);
}

export function LinearGradient(props: LinearGradientProps): JSX.Element {
  return createElement('linearGradient', props);
}

export function Stop(props: StopProps): JSX.Element {
  return createElement('stop', props);
}

export function ClipPath(props: ClipPathProps): JSX.Element {
  return createElement('clipPath', props);
}

export function Mask(props: MaskProps): JSX.Element {
  return createElement('mask', props);
}

export function Image(props: ImageProps): JSX.Element {
  return createElement('image', props);
}

export function Text(props: TextProps): JSX.Element {
  return createElement('text', props);
}

export function TSpan(props: TSpanProps): JSX.Element {
  return createElement('tspan', props);
}

/** The family and weight that name a face in SVG markup: the one place a face becomes a font name. */
export function fontAttrs(face: FontFace): FontAttrs {
  const { family, weight } = FONT_CSS[face];
  return { fontFamily: family, fontWeight: String(weight) };
}

/** What every root `Svg` spreads: the namespace, and what hides a canvas from screen readers (D-277). */
export function svgRootProps(): object {
  return { xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, focusable: 'false' };
}
