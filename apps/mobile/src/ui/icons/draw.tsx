import type { JSX } from 'react';
import { Path, Svg } from 'react-native-svg';

import { size } from '@/ui/tokens';

/** The size of the glyph in points and the one color it is drawn in. */
export type IconGlyphProps = { px: number; color: string };

/** One icon on the 24-unit grid. `strokeWidth` is in grid units; without it the stroke is `size.iconStroke`. */
export type IconDrawing = { d: string; filled: boolean; strokeWidth?: number };

export type IconComponent = (props: IconGlyphProps) => JSX.Element;

/**
 * Draws one interface icon: square caps, miter joins, one color. A filled form is the same shape
 * filled and still stroked; the even-odd rule keeps the cuts of a filled shape open.
 */
export function drawIcon(drawing: IconDrawing, props: IconGlyphProps): JSX.Element {
  const { d, filled, strokeWidth } = drawing;
  const { px, color } = props;
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24">
      <Path
        d={d}
        fill={filled ? color : 'none'}
        fillRule="evenodd"
        stroke={color}
        strokeWidth={strokeWidth ?? size.iconStroke}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </Svg>
  );
}
