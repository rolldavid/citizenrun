import type { JSX } from 'react';
import { CANVAS, CAP_HEIGHT } from '../canvas.ts';
import type { CanvasColors } from '../colors.ts';
import { clipText, fitNumber, fitOneLine, measureText } from '../layout-text.ts';
import { bigNumberPrefix } from '../model/figures.ts';
import type { BigNumberModel } from '../model/region-models.ts';
import { CanvasText } from './canvas-text.tsx';
import type { Ground } from './kicker.tsx';

// CARD-region-big-number: the one heavy thing on a card. The figure is fitted to the measure, not
// stepped, and every fit is measured at zero tracking, so it is the same on every target.

const BASELINE = 836;
const CAPTION_BASELINE = 916;
/** The share of its size a figure moves left, so its left side bearing meets the margin. */
const BEARING = 0.02;

export type BigNumberLayout = {
  /** The top of the figure's capitals: what the holder block above gives way to. */
  capTop: number;
  baseline: number;
  /** The fitted figure; null when the slot holds the unknown phrase. */
  figure: { text: string; x: number; size: number; width: number } | null;
  /** The estimate word before the figure. */
  about: { text: string; x: number; size: number; width: number } | null;
  /** The width the estimate word and its gap take; 0 without a word. */
  prefix: number;
  /** The unknown phrase in the figure's place. */
  phrase: { text: string; x: number; size: number; width: number } | null;
  caption: { text: string; x: number; baseline: number; width: number; cut: boolean };
};

function layoutCaption(caption: string): BigNumberLayout['caption'] {
  const style = { face: 'medium', size: CANVAS.type.caption } as const;
  const text = clipText(caption, style, CANVAS.measure);
  return {
    text,
    x: CANVAS.margin,
    baseline: CAPTION_BASELINE,
    width: measureText(text, style),
    cut: measureText(caption, style) > CANVAS.measure,
  };
}

/** The sizes and positions of the big slot, with the measured width of each line. */
export function layoutBigNumber(model: BigNumberModel): BigNumberLayout {
  const caption = layoutCaption(model.caption);
  if (model.kind === 'unknown') {
    const size = fitOneLine(model.phrase, 'medium', CANVAS.type.bigUnknown, CANVAS.measure);
    return {
      capTop: BASELINE - CAP_HEIGHT * size,
      baseline: BASELINE,
      figure: null,
      about: null,
      prefix: 0,
      phrase: {
        text: model.phrase,
        x: CANVAS.margin,
        size,
        width: measureText(model.phrase, { face: 'medium', size }),
      },
      caption,
    };
  }
  const prefix = bigNumberPrefix(model.aboutWord);
  const size = fitNumber(model.value, CANVAS.measure - prefix, CANVAS.type.bigNumber);
  return {
    capTop: BASELINE - CAP_HEIGHT * size,
    baseline: BASELINE,
    figure: {
      text: model.value,
      x: model.aboutWord === null ? CANVAS.margin - BEARING * size : CANVAS.margin + prefix,
      size,
      width: measureText(model.value, { face: 'bold', size }),
    },
    about:
      model.aboutWord === null
        ? null
        : {
            text: model.aboutWord,
            x: CANVAS.margin,
            size: CANVAS.type.bigAbout,
            width: measureText(model.aboutWord, { face: 'medium', size: CANVAS.type.bigAbout }),
          },
    prefix,
    phrase: null,
    caption,
  };
}

export type BigNumberRegionProps = { model: BigNumberModel; colors: CanvasColors; ground: Ground };

export function BigNumberRegion(props: BigNumberRegionProps): JSX.Element {
  const { model, colors, ground } = props;
  const layout = layoutBigNumber(model);
  const ink = ground === 'poster' ? colors.posterText : colors.text;
  const { about, figure, phrase, caption } = layout;
  return (
    <>
      {about === null ? null : (
        <CanvasText x={about.x} y={layout.baseline} face="medium" size={about.size} fill={ink}>
          {about.text}
        </CanvasText>
      )}
      {figure === null ? null : (
        <CanvasText
          x={figure.x}
          y={layout.baseline}
          face="bold"
          size={figure.size}
          tracking={CANVAS.track.number}
          fill={ink}
        >
          {figure.text}
        </CanvasText>
      )}
      {phrase === null ? null : (
        <CanvasText x={phrase.x} y={layout.baseline} face="medium" size={phrase.size} fill={ink}>
          {phrase.text}
        </CanvasText>
      )}
      {caption.text === '' ? null : (
        <CanvasText
          x={caption.x}
          y={caption.baseline}
          face="medium"
          size={CANVAS.type.caption}
          fill={ink}
        >
          {caption.text}
        </CanvasText>
      )}
    </>
  );
}
