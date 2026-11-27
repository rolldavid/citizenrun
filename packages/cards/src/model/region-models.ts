// The models the shared regions draw. Strings in a model are already translated, formatted and
// folded; a region changes nothing about them except case, where it says so.

/** CARD-region-kicker: the first row of a canvas. The label is in sentence case. */
export type KickerModel = { issueId: string | null; label: string };

/** CARD-region-big-number: the one heavy thing on a card, or the unknown phrase in its place. */
export type BigNumberModel =
  | { kind: 'figure'; value: string; aboutWord: string | null; caption: string }
  | { kind: 'unknown'; phrase: string; caption: string };

/** CARD-region-facts: one of the two ruled facts. */
export type FactModel =
  | {
      kind: 'figure';
      value: string;
      aboutWord: string | null;
      label: string;
      flag: boolean;
      dateLine: string | null;
    }
  | { kind: 'phrase'; phrase: string; label: string; dateLine: string | null };

/** CARD-region-sources: 0, 1 or 2 lines. */
export type SourceLines = readonly string[];

/** CARD-region-office-top: the top zone of an office canvas, and the whole of the office page hero. */
export type OfficeTopModel = {
  kicker: KickerModel;
  /** The office title, or what stands for a title the face cannot draw. */
  title: string;
  place: string;
  electionLine: string;
  holder: { line1: string | null; line2: string | null } | null;
  /** Sentence case; null when the card has no status. */
  sticker: string | null;
  /** A JPEG URL in the app, a JPEG data URI on the server; null draws the illustration. */
  photoHref: string | null;
  illustrationId: string;
};
