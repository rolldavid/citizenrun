/// <reference lib="dom" />
import { BRAND, createI18n } from '@citizenrun/shared';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { expectNoA11yViolations } from './helpers/a11y.ts';
import { freezeClock } from './helpers/clock.ts';
import { shot } from './helpers/shot.ts';

// TEST-e2e-hello: the hello screen inside the shell, in all four projects.

/** The English catalogs: every string the journey compares comes from them. */
const i18n = createI18n();

const READY_WAIT_MS = 60_000;
const READY_POLL_MS = 1_000;

/** Opens `/` and waits until the hello screen has its title. */
async function openHello(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('hello.title')).toBeVisible();
}

/** The three checks read as they do when the server, the database and the worker answer. */
async function expectAllRunning(page: Page): Promise<void> {
  await expect(page.getByTestId('hello.status-server')).toHaveText(i18n.t('hello:status.serverOk'));
  await expect(page.getByTestId('hello.status-database')).toHaveText(
    i18n.t('hello:status.databaseOk'),
  );
  await expect(page.getByTestId('hello.status-worker')).toHaveText(i18n.t('hello:status.workerOk'));
}

/** `200` and the body once the worker's heartbeat is in, else the status and body last seen. */
function readinessLine(status: number, body: string): string {
  return `${String(status)} ${body}`;
}

test.beforeAll(async ({ request }) => {
  // The worker writes its heartbeat at boot; until it lands the worker row reads stale.
  test.setTimeout(90_000);
  await expect
    .poll(
      async () => {
        const response = await request.get('/readyz');
        return readinessLine(response.status(), await response.text());
      },
      { intervals: [READY_POLL_MS], timeout: READY_WAIT_MS },
    )
    .toMatch(/^200 .*"worker":"ok"/);
});

test('shows the hello screen', async ({ page }) => {
  await freezeClock(page);
  await openHello(page);
  await expectAllRunning(page);
  const fitsAcross = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fitsAcross).toBe(true);
  await expectNoA11yViolations(page);
  await shot(page, 'hello-home');
});

test('checks again', async ({ page }) => {
  await freezeClock(page);
  await openHello(page);
  await expectAllRunning(page);
  await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/readyz' && response.status() === 200,
    ),
    page.getByTestId('hello.refresh').click(),
  ]);
  await expectAllRunning(page);
  await expectNoA11yViolations(page);
});

test('shows not found and returns home', async ({ page }) => {
  await freezeClock(page);
  await page.goto('/no-such-page');
  await expect(page.getByTestId('system.not-found-home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(i18n.t('system:notFound.title'));
  await expectNoA11yViolations(page);
  await page.getByTestId('system.not-found-home').click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('hello.title')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('the shell', async ({ page }, testInfo) => {
  await freezeClock(page);
  await openHello(page);
  if (testInfo.project.name.startsWith('desktop-')) {
    // The expanded shell: the skip link comes first and leads to the content.
    await page.keyboard.press('Tab');
    const skipLink = page.getByTestId('shell.skip-link');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await expectNoA11yViolations(page);
    // Signed out, every rail item but Home asks to sign in first.
    await page.getByTestId('shell.rail-explore').click();
    await expect(page).toHaveURL('/sign-in?next=%2Fexplore');
    await expect(page.getByTestId('system.not-found-home')).toBeVisible();
    await expectNoA11yViolations(page);
  } else {
    // The compact shell: the wordmark in the app bar, no rail and no way to Messages yet.
    await expect(page.getByRole('img', { name: BRAND.displayName, exact: true })).toBeVisible();
    await expect(page.getByTestId('shell.rail')).toHaveCount(0);
    await expect(page.getByTestId('shell.app-bar-messages')).toHaveCount(0);
    await expectNoA11yViolations(page);
  }
});
