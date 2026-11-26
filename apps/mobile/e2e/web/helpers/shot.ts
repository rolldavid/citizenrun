/// <reference lib="dom" />
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Compares the whole page with its baseline once the fonts have loaded. Text that depends on the
 * current time carries a testID ending in `-live` and is masked. The pointer leaves the page first,
 * so the control a step last clicked is drawn at rest, not in its hover state. The tolerance, the
 * animation setting and the snapshot path come from the configuration.
 */
export async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(-1, -1);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    mask: [page.locator('[data-testid$="-live"]')],
  });
}
