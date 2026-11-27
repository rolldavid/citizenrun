import type { JSX } from 'react';
import { G, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { round1 } from '../canvas.ts';
import { OFFICE_ART, OFFICE_ART_META } from '../generated/index.ts';
import type { OfficeArtId, OfficeArtRoles } from '../generated/index.ts';
import { OFFICE_TYPE_ILLUSTRATION } from '../generated/office-type-illustrations.ts';

// CARD-art-ids: an office type's drawing is named by its illustration id, from the generated table.
// CARD-art-gen wrappers for the office drawings. The view box and the divisor 96 are the drawings'
// source grid, not visual sizes.

const ILLUSTRATIONS: Readonly<Record<string, string>> = OFFICE_TYPE_ILLUSTRATION;
const FALLBACK_ILLUSTRATION = 'city-council';

/** The illustration id of an office type; `city-council` for an id this build does not know. */
export function illustrationFor(officeTypeId: string): string {
  return Object.hasOwn(ILLUSTRATIONS, officeTypeId)
    ? (ILLUSTRATIONS[officeTypeId] ?? FALLBACK_ILLUSTRATION)
    : FALLBACK_ILLUSTRATION;
}

/** True when the office type is one of the generated table's; false for an id this build does not know. */
export function hasOfficeType(officeTypeId: string): boolean {
  return Object.hasOwn(ILLUSTRATIONS, officeTypeId);
}

/** The four roles plus the neutral tone a placeholder is drawn in. */
export type OfficeArtRolesWithNeutral = OfficeArtRoles & { neutral: string };

function isOfficeArtId(id: string): id is OfficeArtId {
  return Object.hasOwn(OFFICE_ART, id);
}

/** The generated drawing of an id with the roles it takes; an id with no drawing draws the city council. */
function drawingOf(id: string, roles: OfficeArtRolesWithNeutral): JSX.Element {
  const drawn: OfficeArtId = isOfficeArtId(id) ? id : FALLBACK_ILLUSTRATION;
  const Drawing = OFFICE_ART[drawn];
  // A placeholder never takes an issue tone, so it cannot pass for final art.
  const tone = OFFICE_ART_META[drawn].placeholderOf === null ? roles.tone : roles.neutral;
  return <Drawing ink={roles.ink} paper={roles.paper} tone={tone} spot={roles.spot} />;
}

export type OfficeArtProps = {
  id: string;
  x: number;
  y: number;
  size: number;
  roles: OfficeArtRolesWithNeutral;
};

/** Inside a canvas: the drawing placed at (x, y), `size` units square. */
export function OfficeArt(props: OfficeArtProps): JSX.Element {
  // At most three decimals, so a scale such as 5.625 stays exact.
  const scale = Math.round((props.size / 96) * 1000) / 1000;
  return (
    <G
      transform={`translate(${String(round1(props.x))} ${String(round1(props.y))}) scale(${String(scale)})`}
    >
      {drawingOf(props.id, props.roles)}
    </G>
  );
}

export type OfficeArtSvgProps = { id: string; size: number; roles: OfficeArtRolesWithNeutral };

/** Standalone, for the native interface and the contact sheet: `size` points square. */
export function OfficeArtSvg(props: OfficeArtSvgProps): JSX.Element {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 96 96" {...svgRootProps()}>
      {drawingOf(props.id, props.roles)}
    </Svg>
  );
}
