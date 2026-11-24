import type { JSX } from 'react';
import { Circle, Rect, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { round1 } from '../canvas.ts';

// CARD-empty-chair (D-539): a chair in side view on the 96-unit grid, for empty states and the
// screens the app owns. It is written by hand and is never drawn on a card.

export type EmptyChairSvgProps = {
  width: number;
  ink: string;
  paper: string;
  tone: string;
  spot: string;
  crop: 'whole' | 'trimmed';
};

/**
 * The empty chair, `width` wide. `trimmed` leaves out the empty rows above and below the drawing,
 * so text under it starts close to the ground line. The chair has no cut, so nothing takes `paper`.
 */
export function EmptyChairSvg(props: EmptyChairSvgProps): JSX.Element {
  const { width, ink, tone, spot, crop } = props;
  const isTrimmed = crop === 'trimmed';
  return (
    <Svg
      width={width}
      height={isTrimmed ? round1((width * 84) / 96) : width}
      viewBox={isTrimmed ? '0 8 96 84' : '0 0 96 96'}
      {...svgRootProps()}
    >
      <Circle cx={72} cy={24} r={14} fill={tone} />
      <Rect x={26} y={16} width={7} height={72} fill={ink} />
      <Rect x={26} y={54} width={38} height={7} fill={ink} />
      <Rect x={57} y={61} width={7} height={27} fill={ink} />
      <Rect x={36} y={45} width={20} height={9} fill={spot} />
      <Rect x={8} y={88} width={80} height={3} fill={ink} />
    </Svg>
  );
}
