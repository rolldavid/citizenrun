import type { JSX } from 'react';
import type { CanvasColors } from '../colors.ts';
import type { CanvasPage } from '../feed.ts';
import { RunAgainstCanvas } from './run-against.tsx';

// CARD-feed-canvases (D-539): the one component that draws a page, whatever its template.

export type CardCanvasProps = { page: CanvasPage; colors: CanvasColors; width: number };

/** One drawing per template. The type has a row for every template a page can name, so a new one does not compile without its canvas. */
const TEMPLATES: Readonly<Record<CanvasPage['template'], (props: CardCanvasProps) => JSX.Element>> =
  {
    run_against: ({ page, colors, width }) => (
      <RunAgainstCanvas model={page.model} colors={colors} width={width} />
    ),
  };

/** One page as a 4:5 canvas `width` wide. It takes no locale and no handler: a canvas is a still. */
export function CardCanvas(props: CardCanvasProps): JSX.Element {
  return TEMPLATES[props.page.template](props);
}
