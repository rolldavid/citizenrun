import { createElement } from 'react';
import type { JSX, JSXElementConstructor } from 'react';
import {
  Circle as NativeCircle,
  ClipPath as NativeClipPath,
  Defs as NativeDefs,
  G as NativeG,
  Image as NativeImage,
  LinearGradient as NativeLinearGradient,
  Mask as NativeMask,
  Path as NativePath,
  Rect as NativeRect,
  Stop as NativeStop,
  Svg as NativeSvg,
  Text as NativeText,
  TSpan as NativeTSpan,
} from 'react-native-svg';
import { FONT_CSS, FONT_FILES } from '@citizenrun/shared';
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

// CARD-primitives (D-270): each name is the react-native-svg element, for iOS and Android. This is
// the package's one platform file, and the only one that imports react-native-svg.

export const Svg: JSXElementConstructor<SvgProps> = NativeSvg;
export const G: JSXElementConstructor<GProps> = NativeG;
export const Path: JSXElementConstructor<PathProps> = NativePath;
export const Rect: JSXElementConstructor<RectProps> = NativeRect;
export const Circle: JSXElementConstructor<CircleProps> = NativeCircle;
export const Defs: JSXElementConstructor<DefsProps> = NativeDefs;
const AttributeCheckedGradient: JSXElementConstructor<Omit<LinearGradientProps, 'children'>> =
  NativeLinearGradient;
export const LinearGradient =
  AttributeCheckedGradient as JSXElementConstructor<LinearGradientProps>; // its typings ask for an array of elements, yet it draws whatever Stop children it is given
export const Stop: JSXElementConstructor<StopProps> = NativeStop;
export const ClipPath: JSXElementConstructor<ClipPathProps> = NativeClipPath;
export const Mask: JSXElementConstructor<MaskProps> = NativeMask;
export const Image: JSXElementConstructor<ImageProps> = NativeImage;
/** A line of text without pair kerning (D-874): react-native-svg kerns by its own rule on Android unless it is given a number. */
export function Text(props: TextProps): JSX.Element {
  return createElement(NativeText, { ...props, kerning: 0 });
}
export const TSpan: JSXElementConstructor<TSpanProps> = NativeTSpan;

/**
 * The per-file name and the weight that name a face in a canvas on a phone: the one place a face becomes a
 * font name. Android finds a face only by its file name, and iOS draws Medium and Bold only with the weight
 * (D-823 item 5).
 */
export function fontAttrs(face: FontFace): FontAttrs {
  return { fontFamily: FONT_FILES[face], fontWeight: String(FONT_CSS[face].weight) };
}

/** What every root `Svg` spreads: the props that hide a canvas from screen readers (D-277). */
export function svgRootProps(): object {
  return {
    accessible: false,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
  };
}
