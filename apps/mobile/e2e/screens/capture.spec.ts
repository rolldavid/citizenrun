/// <reference lib="dom" />
import { join } from 'node:path';
import { test } from '@playwright/test';
import type { ElementHandle, Page } from '@playwright/test';

import { SCREENS } from './routes.ts';
import type { ScreenEntry } from './routes.ts';

// The design-review capture (TEST-screens-capture). Each image is what a person sees at the
// project's viewport: a react-native-web page scrolls inside an element, not the document, so the
// page is captured one screen at a time by scrolling that element.

const MAX_PARTS = 60;
/** The tallest image Chromium writes, in device pixels. */
const MAX_IMAGE_HEIGHT = 16000;

const out = process.env.SCREENS_OUT;
if (out === undefined || out === '') {
  throw new Error('SCREENS_OUT is not set');
}

function selectedEntries(): ScreenEntry[] {
  const requested = process.env.SCREENS_ROUTES;
  if (requested === undefined || requested.trim() === '') {
    return SCREENS;
  }
  const ids = requested
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const unknown = ids.filter((id) => !SCREENS.some((entry) => entry.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown screen ids: ${unknown.join(', ')}`);
  }
  return SCREENS.filter((entry) => ids.includes(entry.id));
}

/** `360x740-light` gives `360x740` and `light`. */
function projectParts(name: string): { viewport: string; scheme: string } {
  const match = /^(\d+x\d+)-(light|dark)$/.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Project ${name} is not named <width>x<height>-<scheme>`);
  }
  return { viewport: match[1], scheme: match[2] };
}

function partSuffix(part: number): string {
  return `__part${String(part).padStart(2, '0')}`;
}

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

function tooTall(entry: ScreenEntry): Error {
  return new Error(
    `Entry ${entry.id} is taller than ${String(MAX_PARTS)} screens; capture it in parts with a narrower route`,
  );
}

/** Scrolls the element one screen at a time and writes each screen after the first. */
async function captureScrolled(
  page: Page,
  entry: ScreenEntry,
  scroller: ElementHandle<HTMLElement>,
  base: string,
): Promise<void> {
  const measure = (): Promise<{ scrollHeight: number; clientHeight: number }> =>
    scroller.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
  let { scrollHeight, clientHeight } = await measure();
  if (Math.ceil(scrollHeight / clientHeight) > MAX_PARTS) {
    throw tooTall(entry);
  }
  for (let k = 1; k * clientHeight < scrollHeight; k += 1) {
    const part = k + 1;
    if (part > MAX_PARTS) {
      throw tooTall(entry);
    }
    await scroller.evaluate((element, top) => {
      element.scrollTop = top;
    }, k * clientHeight);
    await twoFrames(page);
    await page.screenshot({ path: `${base}${partSuffix(part)}.png` });
    ({ scrollHeight, clientHeight } = await measure());
  }
}

/** One full-page image of a document taller than the window, cut into clips Chromium can write. */
async function captureDocument(
  page: Page,
  entry: ScreenEntry,
  base: string,
  deviceScaleFactor: number,
): Promise<void> {
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  const clipHeight = Math.floor(MAX_IMAGE_HEIGHT / deviceScaleFactor);
  const parts = Math.ceil(height / clipHeight);
  if (parts > MAX_PARTS) {
    throw tooTall(entry);
  }
  for (let index = 0; index < parts; index += 1) {
    const y = index * clipHeight;
    await page.screenshot({
      path: index === 0 ? `${base}.png` : `${base}${partSuffix(index + 1)}.png`,
      fullPage: true,
      clip: { x: 0, y, width, height: Math.min(clipHeight, height - y) },
    });
  }
}

for (const entry of selectedEntries()) {
  test(entry.id, async ({ page }, testInfo) => {
    if (entry.auth !== 'none') {
      throw new Error(
        `Entry ${entry.id} needs a signed-in session, which the capture does not support yet`,
      );
    }
    const { viewport, scheme } = projectParts(testInfo.project.name);
    const deviceScaleFactor = testInfo.project.use.deviceScaleFactor ?? 1;
    await page.goto(entry.path);
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    if (entry.prepare !== undefined) {
      await entry.prepare(page);
    }
    const base = join(out, `${entry.id}__${viewport}__${scheme}`);
    const scroller = await findScroller(page);
    if (scroller !== null) {
      await page.screenshot({ path: `${base}.png` });
      await captureScrolled(page, entry, scroller, base);
      await scroller.dispose();
      return;
    }
    const documentTaller = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    if (documentTaller) {
      await captureDocument(page, entry, base, deviceScaleFactor);
      return;
    }
    await page.screenshot({ path: `${base}.png` });
  });
}
