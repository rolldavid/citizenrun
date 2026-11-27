import type { PersonSummary } from '@citizenrun/shared';
import type { RunAgainstModel } from './model/run-against.ts';

/** What every model builder and alt-text function takes besides its data and t. */
export type CardContext = {
  /** 'en' at launch; passed to the shared formatters. */
  locale: string;
  /** For day counts through daysUntil; never read from the clock here. */
  now: Date;
};

/** What the caller decides for one item before its canvases are built. */
export type FeedCanvasOptions = {
  /** Whether this item may draw a sticker. */
  stickerAllowed: boolean;
  /** The photo a canvas draws for a person, or null for the illustration: a URL in the app, a data URI on the server. */
  photoHrefFor: (person: PersonSummary) => string | null;
};

/** One canvas of an item, ready to draw. */
export type CanvasPage = {
  /** Unique in the item: 'title', or the office id. */
  key: string;
  /** The office the page is about; null on a title page and a prompt. */
  officeId: string | null;
  template: 'run_against'; // widened by the feed templates
  model: RunAgainstModel; // widened by the feed templates
  /** The alt text of this page. */
  alt: string;
};
