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

/** The box of the text that reads `text` inside one row of the gallery. */
async function textBox(
  page: Page,
  row: string,
  text: string,
): Promise<{ x: number; y: number; width: number; height: number; lineHeight: number }> {
  const element = page.getByTestId(row).getByText(text, { exact: true });
  const box = await element.boundingBox();
  if (box === null) {
    throw new Error(`${row} does not draw "${text}"`);
  }
  const lineHeight = await element.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).lineHeight),
  );
  return { ...box, lineHeight };
}

// A fact row's label keeps its words on one line beside a short value and above a long one: a
// value never squeezes it into a column of letters.
test('fact row labels keep their line', async ({ page }) => {
  await page.goto('/dev/gallery?only=fact-row');
  const long = 'gallery.fact-row-long-place';
  await expect(page.getByTestId(long)).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  for (const [row, label, value] of [
    ['gallery.fact-row-known', 'Term', '4 years'],
    [long, 'Where to file', 'The county board of elections office'],
  ] as const) {
    const rowBox = await page.getByTestId(row).boundingBox();
    const labelBox = await textBox(page, row, label);
    const valueElement = page.getByTestId(row).getByText(new RegExp(`^${value}`));
    const valueBox = await valueElement.boundingBox();
    if (rowBox === null || valueBox === null) {
      throw new Error(`${row} is not drawn`);
    }
    // One line of the label, whatever its value.
    expect(labelBox.height, `${row}: the label's lines`).toBeLessThan(labelBox.lineHeight * 1.5);
    // The value stays inside the row, at its right edge.
    expect(valueBox.x + valueBox.width, `${row}: the value's right edge`).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + TOLERANCE,
    );
    if (row === long) {
      // Too long to stand beside the label: it starts under it.
      expect(valueBox.y, `${row}: the value under its label`).toBeGreaterThanOrEqual(
        labelBox.y + labelBox.height - TOLERANCE,
      );
    } else {
      // A short value shares the label's line.
      expect(Math.abs(valueBox.y - labelBox.y), `${row}: one line`).toBeLessThanOrEqual(
        labelBox.lineHeight,
      );
    }
  }
});
