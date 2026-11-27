import type { JSX } from 'react';
import { Rect, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { CANVAS, round1 } from '../canvas.ts';
import type { CanvasColors } from '../colors.ts';
import type { RunAgainstModel } from '../model/run-against.ts';
import { BigNumberRegion, layoutBigNumber } from '../regions/big-number.tsx';
import { FactsRegion } from '../regions/facts.tsx';
import { OfficeTopRegion } from '../regions/office-top.tsx';
import { SourcesRegion } from '../regions/sources.tsx';

// CARD-run-against: the canvas of an office someone could run for, on paper. Top to bottom: the
// office top, the number fitted to the measure, the two ruled facts, the source lines.

export type RunAgainstCanvasProps = { model: RunAgainstModel; colors: CanvasColors; width: number };

const VIEW_BOX = `0 0 ${String(CANVAS.width)} ${String(CANVAS.height)}`;

export function RunAgainstCanvas(props: RunAgainstCanvasProps): JSX.Element {
  const { model, colors, width } = props;
  return (
    <Svg
      width={width}
      height={round1((width * CANVAS.height) / CANVAS.width)}
      viewBox={VIEW_BOX}
      {...svgRootProps()}
    >
      <Rect x={0} y={0} width={CANVAS.width} height={CANVAS.height} fill={colors.surface} />
      <OfficeTopRegion
        model={model.top}
        capTop={layoutBigNumber(model.big).capTop}
        colors={colors}
      />
      <BigNumberRegion model={model.big} colors={colors} ground="paper" />
      <FactsRegion facts={model.facts} colors={colors} ground="paper" />
      <SourcesRegion lines={model.sources} colors={colors} ground="paper" />
    </Svg>
  );
}
