import type { JSX } from 'react';
import { Image, Rect } from '@citizenrun/cards/primitives';
import { OfficeArt } from '../art/office-art.tsx';
import { CANVAS, PHOTO_BOX } from '../canvas.ts';
import { artRoles } from '../colors.ts';
import type { CanvasColors } from '../colors.ts';
import { OFFICE_ART_META } from '../generated/index.ts';
import { baselineFromCapTop, clipText, fitWrapped, layoutText } from '../layout-text.ts';
import type { OfficeTopModel } from '../model/region-models.ts';
import { CanvasText } from './canvas-text.tsx';
import { KickerRegion } from './kicker.tsx';

// CARD-region-office-top: the top zone of an office canvas (kicker, title, place, election line,
// holder block, and the drawing or the photo), and the whole of the office page hero. The holder
// block gives way to the big number below it, never the other way round.

/** The text column beside the art, from the margin. */
const COLUMN = 484;
/** Where the holder lines stop: a little wider than the column. */
const HOLDER_COLUMN = 508;
const TITLE_CAP_TOP = 150;
/** Added to the title's size for its line step. */
const TITLE_LEADING = 4;
/** The title lines at which the holder block is left off. */
const TITLE_LINES_NO_HOLDER = 4;
const PLACE_UNDER_TITLE = 66;
const PLACE_STEP = 48;
const PLACE_LINES = 2;
const ELECTION_UNDER_PLACE = 50;
const HOLDER = { top: 480, underElection: 34, line1: 36, line2: 84, clearance: 40 } as const;
const ART_TOP = 66;
/** The grid the office drawings are made on. */
const ART_GRID = 96;
const FALLBACK_ART = 'city-council';

type Line = { text: string; baseline: number };

export type OfficeTopLayout = {
  title: { size: number; lines: string[]; baselines: number[]; cut: boolean };
  place: { lines: string[]; baselines: number[] };
  election: Line;
  /** The holder lines that are drawn; a line the number leaves no room for is null. */
  holder: { line1: Line | null; line2: Line | null };
  /** The drawing's box; null when the photo is drawn. */
  art: { id: string; x: number; y: number; size: number } | null;
  /** The photo and its keyline; null when the drawing is drawn. */
  photo: {
    href: string;
    box: { x: number; y: number; width: number; height: number };
    keyline: { x: number; y: number; width: number; height: number };
  } | null;
  /** The last baseline drawn in the text column. */
  bottom: number;
};

/** The crop line of a drawing on its grid; the fallback drawing's for an id the set lacks. */
function cropOf(illustrationId: string): number {
  const meta: Readonly<Record<string, { crop: number } | undefined>> = OFFICE_ART_META;
  return (
    (Object.hasOwn(meta, illustrationId) ? meta[illustrationId] : undefined)?.crop ??
    OFFICE_ART_META[FALLBACK_ART].crop
  );
}

/**
 * Every line of the top zone, top to bottom. `capTop` is the top of the big number below, or
 * infinity when nothing is below: a holder line is drawn only when it clears it.
 */
export function layoutOfficeTop(model: OfficeTopModel, capTop: number): OfficeTopLayout {
  const fitted = fitWrapped(model.title, 'medium', CANVAS.type.title, COLUMN);
  const titleStep = fitted.size + TITLE_LEADING;
  const firstTitle = baselineFromCapTop(TITLE_CAP_TOP, fitted.size);
  const titleBaselines = fitted.lines.map((_line, index) => firstTitle + index * titleStep);
  const lastTitle = titleBaselines.at(-1) ?? firstTitle;

  const place = layoutText(
    model.place,
    { face: 'medium', size: CANVAS.type.text },
    COLUMN,
    PLACE_LINES,
  );
  const firstPlace = lastTitle + PLACE_UNDER_TITLE;
  const placeBaselines = place.lines.map((_line, index) => firstPlace + index * PLACE_STEP);
  const lastPlace = placeBaselines.at(-1);

  const election: Line = {
    text: clipText(model.electionLine, { face: 'regular', size: CANVAS.type.text }, COLUMN),
    baseline:
      lastPlace === undefined ? lastTitle + PLACE_UNDER_TITLE : lastPlace + ELECTION_UNDER_PLACE,
  };

  let bottom = election.baseline;
  let line1: Line | null = null;
  let line2: Line | null = null;
  if (model.holder !== null && fitted.lines.length < TITLE_LINES_NO_HOLDER) {
    const top = Math.max(HOLDER.top, election.baseline + HOLDER.underElection);
    const clear = (baseline: number): boolean => baseline + HOLDER.clearance <= capTop;
    if (model.holder.line1 !== null && clear(top + HOLDER.line1)) {
      line1 = {
        text: clipText(
          model.holder.line1,
          { face: 'medium', size: CANVAS.type.caption },
          HOLDER_COLUMN,
        ),
        baseline: top + HOLDER.line1,
      };
      bottom = line1.baseline;
      if (model.holder.line2 !== null && clear(top + HOLDER.line2)) {
        line2 = {
          text: clipText(
            model.holder.line2,
            { face: 'regular', size: CANVAS.type.holderSecond },
            HOLDER_COLUMN,
          ),
          baseline: top + HOLDER.line2,
        };
        bottom = line2.baseline;
      }
    }
  }

  const half = CANVAS.stroke.keyline / 2;
  return {
    title: {
      size: fitted.size,
      lines: fitted.lines,
      baselines: titleBaselines,
      cut: fitted.cut,
    },
    place: { lines: place.lines, baselines: placeBaselines },
    election,
    holder: { line1, line2 },
    art:
      model.photoHref === null
        ? {
            id: model.illustrationId,
            // The drawing's crop line sits on the canvas's right edge.
            x: CANVAS.width - (CANVAS.art.box / ART_GRID) * cropOf(model.illustrationId),
            y: ART_TOP,
            size: CANVAS.art.box,
          }
        : null,
    photo:
      model.photoHref === null
        ? null
        : {
            href: model.photoHref,
            box: PHOTO_BOX,
            keyline: {
              x: PHOTO_BOX.x + half,
              y: PHOTO_BOX.y + half,
              width: PHOTO_BOX.width - CANVAS.stroke.keyline,
              height: PHOTO_BOX.height - CANVAS.stroke.keyline,
            },
          },
    bottom,
  };
}

export type OfficeTopRegionProps = { model: OfficeTopModel; capTop: number; colors: CanvasColors };

/** The top zone on paper: the art or the photo first, then the text column over nothing. */
export function OfficeTopRegion(props: OfficeTopRegionProps): JSX.Element {
  const { model, capTop, colors } = props;
  const layout = layoutOfficeTop(model, capTop);
  const { art, photo, title, place, election, holder } = layout;
  return (
    <>
      {art === null ? null : (
        <OfficeArt
          id={art.id}
          x={art.x}
          y={art.y}
          size={art.size}
          roles={{
            ...artRoles(colors, model.kicker.issueId, 'paper'),
            neutral: colors.textSecondary,
          }}
        />
      )}
      {photo === null ? null : (
        <>
          <Image
            x={photo.box.x}
            y={photo.box.y}
            width={photo.box.width}
            height={photo.box.height}
            href={photo.href}
            preserveAspectRatio="xMidYMid slice"
          />
          <Rect
            x={photo.keyline.x}
            y={photo.keyline.y}
            width={photo.keyline.width}
            height={photo.keyline.height}
            fill="none"
            stroke={colors.ruleSoft}
            strokeWidth={CANVAS.stroke.keyline}
          />
        </>
      )}
      <KickerRegion model={model.kicker} colors={colors} ground="paper" />
      {title.lines.map((line, index) => (
        <CanvasText
          key={`title-${String(index)}`}
          x={CANVAS.margin}
          y={title.baselines[index] ?? 0}
          face="medium"
          size={title.size}
          tracking={CANVAS.track.title}
          fill={colors.text}
        >
          {line}
        </CanvasText>
      ))}
      {place.lines.map((line, index) => (
        <CanvasText
          key={`place-${String(index)}`}
          x={CANVAS.margin}
          y={place.baselines[index] ?? 0}
          face="medium"
          size={CANVAS.type.text}
          fill={colors.text}
        >
          {line}
        </CanvasText>
      ))}
      {election.text === '' ? null : (
        <CanvasText
          x={CANVAS.margin}
          y={election.baseline}
          face="regular"
          size={CANVAS.type.text}
          fill={colors.textSecondary}
        >
          {election.text}
        </CanvasText>
      )}
      {holder.line1 === null ? null : (
        <CanvasText
          x={CANVAS.margin}
          y={holder.line1.baseline}
          face="medium"
          size={CANVAS.type.caption}
          fill={colors.text}
        >
          {holder.line1.text}
        </CanvasText>
      )}
      {holder.line2 === null ? null : (
        <CanvasText
          x={CANVAS.margin}
          y={holder.line2.baseline}
          face="regular"
          size={CANVAS.type.holderSecond}
          fill={colors.textSecondary}
        >
          {holder.line2.text}
        </CanvasText>
      )}
    </>
  );
}
