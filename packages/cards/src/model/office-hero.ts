import type { TFunction } from '@citizenrun/shared';
import type { CardContext, FeedCanvasOptions } from '../feed.ts';
import type { OfficeTopModel } from './region-models.ts';
import { buildRunAgainstModel, holderSentence, titleSentence } from './run-against.ts';
import type { RunAgainstData } from './run-against.ts';

// CARD-office-hero: the hero of the office page is the top zone of the office's canvas.

/** The hero's model: the top of the office's canvas, with no sticker. */
export function buildOfficeHeroModel(
  data: RunAgainstData,
  t: TFunction,
  ctx: CardContext,
  options: FeedCanvasOptions,
): OfficeTopModel {
  return { ...buildRunAgainstModel(data, t, ctx, options).top, sticker: null };
}

/** The hero's alt text: the title sentence, then the holder sentence when there is one. */
export function heroAltText(data: RunAgainstData, t: TFunction, _ctx: CardContext): string {
  const holder = holderSentence(data, t);
  return [titleSentence(data, t), ...(holder === null ? [] : [holder])].join(' ');
}
