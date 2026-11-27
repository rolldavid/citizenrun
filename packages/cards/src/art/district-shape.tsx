import type { JSX } from 'react';
import { outlineViewBox } from '@citizenrun/shared';
import type { Outline } from '@citizenrun/shared';
import { G, Path, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { round1 } from '../canvas.ts';

// CARD-district-shape: a district as one solid shape, with no stroke. The path data comes from a
// bundle, so nothing of it is written into markup before it has passed validOutline.

/** The longer side of an outline's box, in its own units. */
const OUTLINE_BOX = 1000;
const OUTLINE_MAX_CHARS = 20_000;
const OUTLINE_MAX_POINTS = 400;
const OUTLINE_ALPHABET = /^[MLHVZmlhvz0-9 ,.-]+$/;
const POINT_COMMAND = /[ML]/g;

/** True when the string is path data a canvas may draw: line commands and numbers only, within the size an outline has. */
export function validOutline(svg: string): boolean {
  return (
    svg.length <= OUTLINE_MAX_CHARS &&
    OUTLINE_ALPHABET.test(svg) &&
    (svg.match(POINT_COMMAND)?.length ?? 0) <= OUTLINE_MAX_POINTS
  );
}

export type DistrictShapeProps = {
  svg: string;
  bbox: Outline['bbox'];
  x: number;
  y: number;
  size: number;
  fill: string;
};

/** Inside a canvas: the outline centred in a square `size` units wide at (x, y); nothing for an outline that is not valid. */
export function DistrictShape(props: DistrictShapeProps): JSX.Element | null {
  const { svg, bbox, x, y, size, fill } = props;
  if (!validOutline(svg)) {
    return null;
  }
  const { width, height } = outlineViewBox(bbox);
  const scale = size / OUTLINE_BOX;
  const ox = ((OUTLINE_BOX - width) / 2) * scale;
  const oy = ((OUTLINE_BOX - height) / 2) * scale;
  return (
    <G
      transform={`translate(${String(round1(x + ox))} ${String(round1(y + oy))}) scale(${String(scale)})`}
    >
      <Path d={svg} fill={fill} fillRule="evenodd" />
    </G>
  );
}

export type DistrictShapeSvgProps = {
  svg: string;
  bbox: Outline['bbox'];
  size: number;
  fill: string;
};

/** Standalone, for the native interface: `size` points square; empty for an outline that is not valid. */
export function DistrictShapeSvg(props: DistrictShapeSvgProps): JSX.Element {
  const { svg, bbox, size, fill } = props;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      {...svgRootProps()}
    >
      <DistrictShape svg={svg} bbox={bbox} x={0} y={0} size={size} fill={fill} />
    </Svg>
  );
}
