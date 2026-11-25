import type { JSX } from 'react';
import type { IssueId } from '@citizenrun/shared';
import { G, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { ISSUE_ICONS } from '../generated/index.ts';

// CARD-art-gen wrappers for the issue icons. The view box and the divisor 24 are the icons' source
// grid, not visual sizes.

export type IssueIconProps = { id: IssueId; x: number; y: number; size: number; fill: string };

/** Inside a canvas: the icon placed at (x, y), `size` units square. */
export function IssueIcon(props: IssueIconProps): JSX.Element {
  const Icon = ISSUE_ICONS[props.id];
  return (
    <G
      transform={`translate(${String(props.x)} ${String(props.y)}) scale(${String(props.size / 24)})`}
    >
      <Icon fill={props.fill} />
    </G>
  );
}

export type IssueIconSvgProps = { id: IssueId; size: number; fill: string };

/** Standalone, for the native interface (C-IssueTile, the contact sheet): `size` points square. */
export function IssueIconSvg(props: IssueIconSvgProps): JSX.Element {
  const Icon = ISSUE_ICONS[props.id];
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 24 24" {...svgRootProps()}>
      <Icon fill={props.fill} />
    </Svg>
  );
}
