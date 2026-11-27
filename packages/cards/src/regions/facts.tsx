import type { JSX } from 'react';
import { Rect } from '@citizenrun/cards/primitives';
import { CANVAS, round1 } from '../canvas.ts';
import type { CanvasColors } from '../colors.ts';
import { clipText, fitOneLine, measureText } from '../layout-text.ts';
import type { FactModel } from '../model/region-models.ts';
import { CanvasText } from './canvas-text.tsx';
import { fitCapitals } from './kicker.tsx';
import type { Ground } from './kicker.tsx';

// CARD-region-facts: the two ruled facts under the big number. A fact is a figure or a phrase above
// its label; a days-to-file fact has its closing date under the label, and its label on the volt
// flag when seven days or fewer remain.

const RULE_Y = 946;
const DIVIDER_X = 538.5;
const DIVIDER_HEIGHT = 236;
const FIGURE_BASELINE = 1062;
const PHRASE_BASELINE = 1054;
const LABEL_BASELINE = 1122;
const DATE_BASELINE = 1172;
/** The units between the estimate word and the figure after it. */
const ABOUT_GAP = 16;
/** The flag under a label: it starts this far left of the column and the label this far inside it. */
const FLAG = { top: 1082, height: 52, outset: 2, labelInset: 12, padding: 28 } as const;

/** The x and the width of each fact column. */
export const FACT_COLUMNS = [
  { x: CANVAS.margin, width: 448 },
  { x: 576, width: 438 },
] as const;

export type FactLayout = {
  x: number;
  /** The column's width. */
  width: number;
  figure: {
    text: string;
    x: number;
    size: number;
    /** The estimate word, its gap and the figure together, at this size. */
    width: number;
    fits: boolean;
    about: { text: string; x: number; width: number } | null;
  } | null;
  phrase: { text: string; size: number; width: number; fits: boolean } | null;
  label: {
    text: string;
    x: number;
    width: number;
    cut: boolean;
    /** The volt block the label sits on. */
    flag: { x: number; y: number; width: number; height: number } | null;
  };
  dateLine: { text: string; width: number; cut: boolean } | null;
};

function layoutFigure(
  fact: Extract<FactModel, { kind: 'figure' }>,
  column: { x: number; width: number },
): NonNullable<FactLayout['figure']> {
  const aboutWidth =
    fact.aboutWord === null
      ? 0
      : measureText(fact.aboutWord, { face: 'medium', size: CANVAS.type.caption });
  const lead = fact.aboutWord === null ? 0 : aboutWidth + ABOUT_GAP;
  const widthAt = (size: number): number => lead + measureText(fact.value, { face: 'bold', size });
  const steps: readonly number[] = CANVAS.type.fact;
  const last = steps.at(-1) ?? CANVAS.type.fact[0];
  const size = steps.find((step) => widthAt(step) <= column.width) ?? last;
  return {
    text: fact.value,
    x: column.x + lead,
    size,
    width: widthAt(size),
    fits: widthAt(size) <= column.width,
    about:
      fact.aboutWord === null ? null : { text: fact.aboutWord, x: column.x, width: aboutWidth },
  };
}

function layoutLabel(
  label: string,
  flagged: boolean,
  column: { x: number; width: number },
): FactLayout['label'] {
  if (!flagged) {
    return { ...fitCapitals(label, column.width), x: column.x, flag: null };
  }
  // The block ends inside the column: its padding less its outset is what the label gives up.
  const fitted = fitCapitals(label, column.width - (FLAG.padding - FLAG.outset));
  return {
    ...fitted,
    x: column.x + FLAG.labelInset,
    flag: {
      x: column.x - FLAG.outset,
      y: FLAG.top,
      width: fitted.width + FLAG.padding,
      height: FLAG.height,
    },
  };
}

function layoutDateLine(dateLine: string, width: number): NonNullable<FactLayout['dateLine']> {
  const style = { face: 'regular', size: CANVAS.type.text } as const;
  const text = clipText(dateLine, style, width);
  return { text, width: measureText(text, style), cut: measureText(dateLine, style) > width };
}

/** One fact in its column: every size and position, with the measured width of each line. */
export function layoutFact(fact: FactModel, column: { x: number; width: number }): FactLayout {
  const base = { x: column.x, width: column.width };
  const dateLine = fact.dateLine === null ? null : layoutDateLine(fact.dateLine, column.width);
  if (fact.kind === 'phrase') {
    const size = fitOneLine(fact.phrase, 'medium', CANVAS.type.unknown, column.width);
    const width = measureText(fact.phrase, { face: 'medium', size });
    return {
      ...base,
      figure: null,
      phrase: { text: fact.phrase, size, width, fits: width <= column.width },
      label: layoutLabel(fact.label, false, column),
      dateLine,
    };
  }
  return {
    ...base,
    figure: layoutFigure(fact, column),
    phrase: null,
    label: layoutLabel(fact.label, fact.flag, column),
    dateLine,
  };
}

/** The two facts, each in its column. */
export function layoutFacts(facts: readonly [FactModel, FactModel]): [FactLayout, FactLayout] {
  return [layoutFact(facts[0], FACT_COLUMNS[0]), layoutFact(facts[1], FACT_COLUMNS[1])];
}

export type FactsRegionProps = {
  facts: readonly [FactModel, FactModel];
  colors: CanvasColors;
  ground: Ground;
};

function drawFact(fact: FactLayout, ink: string, colors: CanvasColors): JSX.Element {
  const { figure, phrase, label, dateLine } = fact;
  return (
    <>
      {figure?.about == null ? null : (
        <CanvasText
          x={figure.about.x}
          y={FIGURE_BASELINE}
          face="medium"
          size={CANVAS.type.caption}
          fill={ink}
        >
          {figure.about.text}
        </CanvasText>
      )}
      {figure === null ? null : (
        <CanvasText
          x={figure.x}
          y={FIGURE_BASELINE}
          face="bold"
          size={figure.size}
          tracking={CANVAS.track.number}
          fill={ink}
        >
          {figure.text}
        </CanvasText>
      )}
      {phrase === null ? null : (
        <CanvasText x={fact.x} y={PHRASE_BASELINE} face="medium" size={phrase.size} fill={ink}>
          {phrase.text}
        </CanvasText>
      )}
      {label.flag === null ? null : (
        <Rect
          x={label.flag.x}
          y={label.flag.y}
          width={round1(label.flag.width)}
          height={label.flag.height}
          fill={colors.highlight}
          stroke={colors.onHighlight}
          strokeWidth={CANVAS.stroke.keyline}
        />
      )}
      {label.text === '' ? null : (
        <CanvasText
          x={label.x}
          y={LABEL_BASELINE}
          face="mono"
          size={CANVAS.type.mono}
          tracking={CANVAS.track.caps}
          fill={label.flag === null ? ink : colors.onHighlight}
        >
          {label.text}
        </CanvasText>
      )}
      {dateLine === null ? null : (
        <CanvasText x={fact.x} y={DATE_BASELINE} face="regular" size={CANVAS.type.text} fill={ink}>
          {dateLine.text}
        </CanvasText>
      )}
    </>
  );
}

export function FactsRegion(props: FactsRegionProps): JSX.Element {
  const { facts, colors, ground } = props;
  const ink = ground === 'poster' ? colors.posterText : colors.text;
  const [first, second] = layoutFacts(facts);
  return (
    <>
      <Rect
        x={CANVAS.margin}
        y={RULE_Y}
        width={CANVAS.measure}
        height={CANVAS.stroke.mainRule}
        fill={ink}
      />
      <Rect
        x={DIVIDER_X}
        y={RULE_Y}
        width={CANVAS.stroke.divider}
        height={DIVIDER_HEIGHT}
        fill={ink}
      />
      {drawFact(first, ink, colors)}
      {drawFact(second, ink, colors)}
    </>
  );
}
