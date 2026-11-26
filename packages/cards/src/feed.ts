/** What every model builder and alt-text function takes besides its data and t. */
export type CardContext = {
  /** 'en' at launch; passed to the shared formatters. */
  locale: string;
  /** For day counts through daysUntil; never read from the clock here. */
  now: Date;
};
