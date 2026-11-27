import type { JSX } from 'react';
import { Rect, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { CANVAS, round1 } from '../canvas.ts';
import type { CanvasColors } from '../colors.ts';
import type { OfficeTopModel } from '../model/region-models.ts';
import { layoutOfficeTop, OfficeTopRegion } from '../regions/office-top.tsx';

// CARD-office-hero: the hero of the office page is the top zone of the office's canvas with nothing
// below it to give way to, so the holder block is always whole. It carries no number.

/** The air under the last baseline of the text column. */
const UNDER_LAST_LINE = 60;

/** The hero's height in units: its least height, or more when the text column runs longer. */
export function officeHeroHeight(model: OfficeTopModel): number {
  return Math.max(
    CANVAS.heroMinHeight,
    Math.round(layoutOfficeTop(model, Infinity).bottom + UNDER_LAST_LINE),
  );
}

export type OfficeHeroCanvasProps = { model: OfficeTopModel; colors: CanvasColors; width: number };

export function OfficeHeroCanvas(props: OfficeHeroCanvasProps): JSX.Element {
  const { model, colors, width } = props;
  const height = officeHeroHeight(model);
  return (
    <Svg
      width={width}
      height={round1((width * height) / CANVAS.width)}
      viewBox={`0 0 ${String(CANVAS.width)} ${String(height)}`}
      {...svgRootProps()}
    >
      <Rect x={0} y={0} width={CANVAS.width} height={height} fill={colors.surface} />
      <OfficeTopRegion model={model} capTop={Infinity} colors={colors} />
    </Svg>
  );
}
