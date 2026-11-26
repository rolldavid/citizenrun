/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import type { ElementHandle, Page } from '@playwright/test';

import { expectNoA11yViolations } from './helpers/a11y.ts';

// The list spike (D-100 row 8): 1,000 rows of three kinds through C-List in the production web
// export, in all four projects. Deleted with the list spike's route when the feed replaces it.

const ROW_COUNT = 1000;
const LAST_ROW = ROW_COUNT - 1;
const ROW_PREFIX = 'dev.list-spike-row-';
const MAX_STEPS = 2000;
/** A tenth of the list: more rendered rows than this means the rows are not recycled. */
const MAX_RENDERED_ROWS = 100;
/** The share of the visible height each step scrolls by, so consecutive views overlap. */
const STEP_SHARE = 0.8;
/** The report-only policy's notices block nothing and are not the list's (D-100 row 8). */
const REPORT_ONLY_PREFIX = '[Report Only]';

/** What one look at the list finds. */
type Look = {
  /** The indices of the rows in the page. */
  indices: number[];
  /** True when at least one row overlaps the scrolling element's visible box. */
  rowInView: boolean;
  /** True when the last row overlaps the visible box. */
  lastInView: boolean;
  /** True when the element is scrolled to its end. */
  atEnd: boolean;
  clientHeight: number;
};

/** Waits for two animation frames, so a scroll has been handled and drawn. */
async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve(null);
          }),
        ),
      ),
  );
}

/** The element that scrolls the most, when one scrolls by more than one pixel. */
async function findScroller(page: Page): Promise<ElementHandle<HTMLElement> | null> {
  const handle = await page.evaluateHandle(() => {
    let best: HTMLElement | null = null;
    let bestRange = 1;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') {
        continue;
      }
      const range = element.scrollHeight - element.clientHeight;
      if (range > bestRange) {
        best = element;
        bestRange = range;
      }
    }
    return best;
  });
  const element = handle.asElement();
  if (element === null) {
    await handle.dispose();
    return null;
  }
  return element;
}

/** Reads the rows in the page and where they stand against the scrolling element's visible box. */
function look(scroller: ElementHandle<HTMLElement>): Promise<Look> {
  return scroller.evaluate(
    (element, { prefix, last }) => {
      const box = element.getBoundingClientRect();
      const overlaps = (row: Element): boolean => {
        const rect = row.getBoundingClientRect();
        return (
          rect.height > 0 &&
          rect.bottom > box.top &&
          rect.top < box.bottom &&
          rect.right > box.left &&
          rect.left < box.right
        );
      };
      const rows = Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`));
      const lastRow = document.querySelector(`[data-testid="${prefix}${String(last)}"]`);
      return {
        indices: rows.map((row) => Number(row.getAttribute('data-testid')?.slice(prefix.length))),
        rowInView: rows.some(overlaps),
        lastInView: lastRow !== null && overlaps(lastRow),
        atEnd: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
        clientHeight: element.clientHeight,
      };
    },
    { prefix: ROW_PREFIX, last: LAST_ROW },
  );
}

test('a list of 1,000 rows of three kinds scrolls to the end with recycling and no console error', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const reportOnly: string[] = [];
  const keep = (text: string): void => {
    (text.startsWith(REPORT_ONLY_PREFIX) ? reportOnly : errors).push(text);
  };
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // A logged-out visitor's session probe answers 401 by design; the browser logs that response itself.
    const probe =
      message.location().url.endsWith('/v1/me') && message.text().includes('status of 401');
    if (!probe) keep(message.text());
  });
  page.on('pageerror', (error) => {
    keep(error.message);
  });

  await page.goto('/dev/spikes/list');
  await expect(page.getByTestId(`${ROW_PREFIX}0`)).toBeVisible();
  await expectNoA11yViolations(page);

  const scroller = await findScroller(page);
  if (scroller === null) {
    throw new Error('No scrolling element found');
  }

  const started = Date.now();
  const first = await look(scroller);
  let maxRendered = first.indices.length;
  let blankSeen = !first.rowInView;
  let reachedEnd = first.lastInView && first.atEnd;
  let steps = 0;
  let view = first;
  while (!reachedEnd && steps < MAX_STEPS) {
    const by = Math.round(view.clientHeight * STEP_SHARE);
    await scroller.evaluate((element, distance) => {
      element.scrollTop += distance;
    }, by);
    await twoFrames(page);
    steps += 1;
    view = await look(scroller);
    maxRendered = Math.max(maxRendered, view.indices.length);
    if (!view.rowInView) blankSeen = true;
    reachedEnd = view.lastInView && view.atEnd;
  }
  const elapsed = Date.now() - started;

  test.info().annotations.push(
    { type: 'max-rendered-rows', description: String(maxRendered) },
    { type: 'steps', description: String(steps) },
    {
      type: 'report-only-notices',
      description:
        reportOnly.length === 0
          ? '0'
          : `${String(reportOnly.length)}: ${reportOnly[0] ?? ''}`.slice(0, 500),
    },
    { type: 'elapsed-ms', description: String(elapsed) },
  );

  expect(reachedEnd, 'the loop ended at the last row, not at the step limit').toBe(true);
  await expect(page.getByTestId(`${ROW_PREFIX}${String(LAST_ROW)}`)).toBeVisible();
  expect(maxRendered).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  await expect(page.getByTestId(`${ROW_PREFIX}0`)).toHaveCount(0);
  expect(blankSeen, 'a view with no row in it was seen while scrolling').toBe(false);
  expect(first.indices).toEqual(expect.arrayContaining([0, 1, 2]));
  expect(errors).toEqual([]);
  await scroller.dispose();
});
