/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { expectNoA11yViolations } from './helpers/a11y.ts';

// The slots of C-ActionRow keep their place when Follow and Bookmark turn on and when Run changes
// its label: each part of a row is measured against the row's own box in the two states. A test
// in jsdom lays nothing out, so this runs in the browser, in all four projects. It takes no
// screenshot.

/** The parts of a row a screen can press. */
type Part = 'run' | 'follow' | 'bookmark';

/** Two rows of the gallery that differ only in what their controls say, and the parts both draw. */
const PAIRS: readonly { before: string; after: string; parts: readonly Part[] }[] = [
  // Run is not drawn until it exists: Follow takes its room.
  {
    before: 'gallery.action-row-row-hidden',
    after: 'gallery.action-row-row-hidden-done',
    parts: ['follow', 'bookmark'],
  },
  {
    before: 'gallery.action-row-row-idle',
    after: 'gallery.action-row-row-running',
    parts: ['run', 'follow', 'bookmark'],
  },
  {
    before: 'gallery.action-row-sticky',
    after: 'gallery.action-row-sticky-done',
    parts: ['run', 'follow', 'bookmark'],
  },
];
/** The last row of the section: when it is drawn, every row is. */
const LAST_ROW = 'office.actions';
/** How far a part may be from its twin, in CSS pixels. */
const TOLERANCE = 1;

/** Where a part stands in its row: its left edge from the row's own, and its width. */
type Slot = { left: number; width: number };

async function slotOf(page: Page, row: string, part: Part): Promise<Slot> {
  const rowBox = await page.getByTestId(row).boundingBox();
  const partBox = await page.getByTestId(`${row}-${part}`).boundingBox();
  if (rowBox === null || partBox === null) {
    throw new Error(`${row}-${part} is not drawn`);
  }
  return { left: partBox.x - rowBox.x, width: partBox.width };
}

test('action row slots keep their place', async ({ page }) => {
  await page.goto('/dev/gallery?only=action-row');
  await expect(page.getByTestId(LAST_ROW)).toBeVisible();
  // A label is measured in its own face.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expectNoA11yViolations(page);

  for (const { before, after, parts } of PAIRS) {
    await expect(page.getByTestId(before)).toBeVisible();
    await expect(page.getByTestId(after)).toBeVisible();
    for (const part of parts) {
      const first = await slotOf(page, before, part);
      const second = await slotOf(page, after, part);
      const name = `${before} and ${after}, ${part}`;
      expect(first.width, name).toBeGreaterThan(0);
      expect(Math.abs(first.left - second.left), `${name}: left`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(first.width - second.width), `${name}: width`).toBeLessThanOrEqual(TOLERANCE);
    }
  }
  // Before Run exists its slot is not drawn at all.
  await expect(page.getByTestId('gallery.action-row-row-hidden-run')).toHaveCount(0);
  await expect(page.getByTestId('gallery.action-row-row-hidden-done-run')).toHaveCount(0);
});
