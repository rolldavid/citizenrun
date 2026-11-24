// The first screen of a page load (DS-focus). It keeps the document's own starting focus, so the
// first Tab reaches the skip link; only a later screen takes focus to its heading.

/** The heading of the first screen of the page load: undefined until one mounts, null once the load is behind. */
let firstHeading: object | null | undefined;

/**
 * True for the heading of the first screen of the page load, each time it is asked about: the first
 * heading asked about becomes it. False for every other heading.
 */
export function isFirstScreen(heading: object): boolean {
  if (firstHeading === undefined) {
    firstHeading = heading;
    return true;
  }
  return firstHeading === heading;
}

/**
 * For tests, which mount many screens in one document: 'start' begins a page load, whose next
 * heading is the first screen's; 'behind' puts the load behind them, so every heading is a later
 * screen's.
 */
export function setPageLoad(state: 'start' | 'behind'): void {
  firstHeading = state === 'start' ? undefined : null;
}
