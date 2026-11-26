/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

import { SELECTORS } from '../selectors.ts';
import { signUpThroughApi } from './helpers/accounts.ts';
import { expectNoA11yViolations } from './helpers/a11y.ts';
import { apiHeaders, operationPath } from './helpers/api.ts';
import { t } from './helpers/catalog.ts';
import { clientAddress, newRunId } from './helpers/run-id.ts';
import { shot } from './helpers/shot.ts';

// CTL-35: the deletion screen says what is removed, what is kept and for how long, asks once in a
// dialog that does not put its focus on the destructive action, and ends the session on the device
// and the server.

const { settings } = SELECTORS;

const JOURNEY_TIMEOUT_MS = 90_000;
/** What the screen says, in its order; each line must be on it. */
const STATED_KEYS = [
  'settings:delete.intro',
  'settings:delete.when',
  'settings:delete.undo',
  'settings:delete.threads',
  'settings:delete.keptTitle',
  'settings:delete.keptHolds',
  'settings:delete.keptReports',
  'settings:delete.keptOpenReports',
  'settings:delete.keptRecords',
  'settings:delete.keptBan',
  'settings:delete.keptBackups',
] as const;

/** The opacity an element is drawn with: its own times every ancestor's. */
function drawnOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    let opacity = 1;
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    return opacity;
  });
}

test('an account is deleted from settings', async ({ context, page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const runId = newRunId();
  const handle = `del${runId}`;
  const address = clientAddress(runId);
  await context.setExtraHTTPHeaders({ 'x-real-ip': address });
  await signUpThroughApi(context, { email: `del_${runId}@example.test`, handle, address });
  // The browser keeps the real clock here: whether the sign-in is recent enough to delete without
  // signing in again is read against the server's time.

  // Step 1: what deleting removes and keeps, and the way to export first.
  await page.goto('/settings');
  await page.getByTestId(settings.rowDeleteAccount).click();
  await expect(page).toHaveURL('/settings/delete-account');
  for (const key of STATED_KEYS) {
    await expect(page.getByText(t(key), { exact: true }), key).toBeVisible();
  }
  await expect(page.getByTestId(settings.deleteExportFirst)).toHaveAttribute(
    'href',
    '/settings/export',
  );
  await expectNoA11yViolations(page);
  await shot(page, 'delete-account-info');

  // Step 2: one question, naming the handle, with the focus away from the destructive action.
  await page.getByTestId(settings.deleteAction).click();
  const dialog = page.getByRole('alertdialog', { name: t('settings:delete.confirmTitle') });
  await expect(dialog).toBeVisible();
  // The dialog fades in, even with reduced motion; it is checked once it is fully drawn.
  await expect.poll(() => drawnOpacity(dialog)).toBe(1);
  const namesHandle = (await dialog.innerText()).includes(`@${handle}`);
  expect(namesHandle, 'the dialog names the handle').toBe(true);
  await expect(page.getByTestId(settings.deleteConfirm)).not.toBeFocused();
  await expectNoA11yViolations(page);
  await shot(page, 'delete-account-confirm');

  // Step 3: no fresh sign-in is asked (signed in minutes ago); the session ends on both sides.
  await page.getByTestId(settings.deleteConfirm).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(welcome)?$/);
  const me = await page.request.get(operationPath('getMe'), { headers: await apiHeaders(page) });
  expect(me.status(), 'GET /v1/me answers 401 once the account is deleted').toBe(401);
  await expectNoA11yViolations(page);
});
