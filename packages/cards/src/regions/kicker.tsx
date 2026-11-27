import type { JSX } from 'react';
import { isIssueId } from '@citizenrun/shared';
import type { IssueId } from '@citizenrun/shared';
import { Rect } from '@citizenrun/cards/primitives';
import { IssueIcon } from '../art/issue-icon.tsx';
import { CANVAS } from '../canvas.ts';
import type { CanvasColors } from '../colors.ts';
import { clipText, measureText } from '../layout-text.ts';
import type { TextStyle } from '../layout-text.ts';
import type { KickerModel } from '../model/region-models.ts';
import { CanvasText } from './canvas-text.tsx';

// CARD-region-kicker: the first row of every canvas, y 66 to 122. The issue's tile leads its short
// name, so the color in the drawing is named by its icon; a canvas with no issue has the label alone.

export type Ground = 'paper' | 'poster';

const ROW_TOP = 66;
const BASELINE = 108;
/** The icon sits inside the tile by half of what the tile has over it. */
const ICON_INSET = (CANVAS.tile.size - CANVAS.tile.icon) / 2;
/** Where the label starts beside a tile. */
const LABEL_X_TILED = 140;

const LABEL_STYLE: TextStyle = {
  face: 'mono',
  size: CANVAS.type.mono,
  tracking: CANVAS.track.caps,
};

/** A label as a canvas sets it: capitals, in the launch language. */
export function capitals(label: string): string {
  return label.toLocaleUpperCase('en-US');
}

/** The width of a label in capitals, with its tracking. */
export function capitalsWidth(label: string): number {
  return measureText(label, LABEL_STYLE);
}

/** One label in capitals cut to a width: what is drawn, how wide it is, and whether it was cut. */
export function fitCapitals(
  label: string,
  maxWidth: number,
): { text: string; width: number; cut: boolean } {
  const upper = capitals(label);
  const text = clipText(upper, LABEL_STYLE, maxWidth);
  return { text, width: capitalsWidth(text), cut: capitalsWidth(upper) > maxWidth };
}

export type KickerLayout = {
  /** True when the tile leads the label. */
  tiled: boolean;
  label: { text: string; x: number; baseline: number; width: number; cut: boolean };
};

/** Where the label sits and what of it is drawn; `tiled` says whether an issue tile leads it. */
export function layoutKicker(model: KickerModel, tiled: boolean): KickerLayout {
  const x = tiled ? LABEL_X_TILED : CANVAS.margin;
  const fitted = fitCapitals(model.label, CANVAS.width - CANVAS.margin - x);
  return { tiled, label: { ...fitted, x, baseline: BASELINE } };
}

/** The issue whose tile a kicker draws: one this build knows and the colors hold; else null. */
export function tileIssue(model: KickerModel, colors: CanvasColors): IssueId | null {
  const id = model.issueId;
  return id !== null && isIssueId(id) && Object.hasOwn(colors.issue, id) ? id : null;
}

export type KickerRegionProps = { model: KickerModel; colors: CanvasColors; ground: Ground };

export function KickerRegion(props: KickerRegionProps): JSX.Element {
  const { model, colors, ground } = props;
  const issueId = tileIssue(model, colors);
  const issue = issueId === null ? undefined : colors.issue[issueId];
  const { label } = layoutKicker(model, issue !== undefined);
  const ink = ground === 'poster' ? colors.posterText : colors.text;
  return (
    <>
      {issueId !== null && issue !== undefined ? (
        <>
          <Rect
            x={CANVAS.margin}
            y={ROW_TOP}
            width={CANVAS.tile.size}
            height={CANVAS.tile.size}
            fill={ground === 'poster' ? issue.poster : issue.fill}
          />
          <IssueIcon
            id={issueId}
            x={CANVAS.margin + ICON_INSET}
            y={ROW_TOP + ICON_INSET}
            size={CANVAS.tile.icon}
            fill={issue.on}
          />
        </>
      ) : null}
      {label.text === '' ? null : (
        <CanvasText
          x={label.x}
          y={label.baseline}
          face="mono"
          size={CANVAS.type.mono}
          tracking={CANVAS.track.caps}
          fill={ink}
        >
          {label.text}
        </CanvasText>
      )}
    </>
  );
}
