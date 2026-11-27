import type { JSX } from 'react';
import { fontAttrs, Text } from '@citizenrun/cards/primitives';
import { CANVAS, round1 } from '../canvas.ts';
import type { FontFace } from '../primitives/types.ts';

// CARD-primitives: the one place a region writes a line of text, so every line is emitted the same way
// on every target.

export type CanvasTextProps = {
  x: number;
  /** The baseline. */
  y: number;
  face: FontFace;
  size: number;
  /** In em; left out of the markup while tracked text is switched off. */
  tracking?: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
  children: string;
};

/** The tracking switch, read as a boolean so both of its branches stay in the code. */
const SWITCHES: { trackingEnabled: boolean } = CANVAS;

/** One line of text at a baseline: its numbers rounded to one decimal place as they are written. */
export function CanvasText(props: CanvasTextProps): JSX.Element {
  const { x, y, face, size, tracking = 0, fill, anchor, children } = props;
  return (
    <Text
      x={round1(x)}
      y={round1(y)}
      {...fontAttrs(face)}
      fontSize={size}
      fill={fill}
      {...(anchor === undefined ? {} : { textAnchor: anchor })}
      {...(SWITCHES.trackingEnabled && tracking !== 0
        ? { letterSpacing: round1(tracking * size) }
        : {})}
    >
      {children}
    </Text>
  );
}
