import type { Page } from '@playwright/test';

/** The one instant every journey's browser clock is fixed at. */
export const E2E_NOW = new Date('2027-01-15T15:00:00.000Z');

/** Fixes the browser's clock at E2E_NOW; a journey calls it before its first navigation. */
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(E2E_NOW);
}
