import type { JSX } from 'react';
import { CANVAS } from '../canvas.ts';
import type { CanvasColors } from '../colors.ts';
import { measureText } from '../layout-text.ts';
import type { SourceLines } from '../model/region-models.ts';
import { CanvasText } from './canvas-text.tsx';
import type { Ground } from './kicker.tsx';

// CARD-region-sources, the drawn half (D-568): the source lines at the foot of a canvas, in the mono
// in sentence case. Each line says what it covers.

/** The baselines a canvas has for source lines. */
const BASELINES = [1240, 1288] as const;

export type SourceLineLayout = { text: string; x: number; baseline: number; width: number };

/** The lines a canvas has room for, each on its baseline with its measured width. */
export function layoutSources(lines: SourceLines): SourceLineLayout[] {
  return BASELINES.flatMap((baseline, index) => {
    const text = lines[index];
    return text === undefined || text === ''
      ? []
      : [
          {
            text,
            x: CANVAS.margin,
            baseline,
            width: measureText(text, { face: 'mono', size: CANVAS.type.mono }),
          },
        ];
  });
}

export type SourcesRegionProps = { lines: SourceLines; colors: CanvasColors; ground: Ground };

export function SourcesRegion(props: SourcesRegionProps): JSX.Element {
  const { lines, colors, ground } = props;
  const secondary = ground === 'poster' ? colors.posterTextSecondary : colors.textSecondary;
  return (
    <>
      {layoutSources(lines).map((line) => (
        <CanvasText
          key={line.baseline}
          x={line.x}
          y={line.baseline}
          face="mono"
          size={CANVAS.type.mono}
          fill={secondary}
        >
          {line.text}
        </CanvasText>
      ))}
    </>
  );
}
