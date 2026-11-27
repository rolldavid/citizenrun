import type { JSX } from 'react';
import { G, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { PIN_GLYPHS } from '../generated/index.ts';
import type { OfficeArtId } from '../generated/index.ts';

// CARD-office-glyphs: the wrappers for the one-color office glyphs. The view box and the divisor 24
// are the glyphs' source grid, not visual sizes.

const FALLBACK_GLYPH = 'city-council';

function isGlyphId(id: string): id is OfficeArtId {
  return Object.hasOwn(PIN_GLYPHS, id);
}

/** The generated glyph of an id in one color; an id with no glyph draws the city council's. */
function glyphOf(id: string, fill: string): JSX.Element {
  const Glyph = PIN_GLYPHS[isGlyphId(id) ? id : FALLBACK_GLYPH];
  return <Glyph fill={fill} />;
}

export type OfficeGlyphProps = { id: string; x: number; y: number; size: number; fill: string };

/** Inside a canvas: the glyph placed at (x, y), `size` units square. */
export function OfficeGlyph(props: OfficeGlyphProps): JSX.Element {
  return (
    <G
      transform={`translate(${String(props.x)} ${String(props.y)}) scale(${String(props.size / 24)})`}
    >
      {glyphOf(props.id, props.fill)}
    </G>
  );
}

export type OfficeGlyphSvgProps = { id: string; size: number; fill: string };

/** Standalone, for the native interface (C-OfficeTile, map pins, the contact sheet): `size` points square. */
export function OfficeGlyphSvg(props: OfficeGlyphSvgProps): JSX.Element {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 24 24" {...svgRootProps()}>
      {glyphOf(props.id, props.fill)}
    </Svg>
  );
}
