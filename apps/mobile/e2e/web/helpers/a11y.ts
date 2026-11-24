import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The WCAG A and AA rules every journey step is checked against; none is turned off (TEST-a11y-auto). */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Runs axe on the page as it is now and fails, naming each rule and node, on any violation. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}
