/// <reference lib="dom" />
import { MeSchema } from '@citizenrun/shared';
import type { Me } from '@citizenrun/shared';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { SELECTORS } from '../selectors.ts';
import { expectNoA11yViolations } from './helpers/a11y.ts';
import { apiHeaders, operationPath } from './helpers/api.ts';
import { t } from './helpers/catalog.ts';
import { freezeClock } from './helpers/clock.ts';
import { readCode } from './helpers/mailbox.ts';
import { clientAddress, newRunId } from './helpers/run-id.ts';
import { shot } from './helpers/shot.ts';

// TEST-e2e-signup: a first-time sign-up from the welcome screen to Home, in all four projects, with
// BUD-signup-time's guard on the machine time from the first press to Home.

const { auth, onboarding, feed } = SELECTORS;

/** BUD-signup-time's regression guard: the machine time of steps 2 to 9. */
const SIGNUP_BUDGET_MS = 15_000;
const JOURNEY_TIMEOUT_MS = 120_000;
/** A handle the seed holds, so the check answers that it is taken. */
const TAKEN_HANDLE = 'seed_user_01';
const PICKS = ['rent-housing', 'climate', 'schools'] as const;
const STARRED = 'rent-housing';

/** `GET /v1/me` as the page's session: its status, and the account when it answers 200. */
async function readMe(page: Page): Promise<{ status: number; me: Me | null }> {
  const response = await page.request.get(operationPath('getMe'), {
    headers: await apiHeaders(page),
  });
  if (response.status() !== 200) {
    return { status: response.status(), me: null };
  }
  return { status: 200, me: MeSchema.parse(await response.json()) };
}

/** The account behind the page's session; fails when there is none. */
async function signedInMe(page: Page): Promise<Me> {
  const { status, me } = await readMe(page);
  expect(status, 'GET /v1/me answers 200').toBe(200);
  if (me === null) {
    throw new Error('GET /v1/me answered no account');
  }
  return me;
}

test('a new person signs up and reaches Home', async ({ page }, testInfo) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const runId = newRunId();
  const email = `e2e_${testInfo.project.name}_${runId}@example.test`;
  const handle = `e2e${runId}`;
  await page.setExtraHTTPHeaders({ 'x-real-ip': clientAddress(runId) });
  await freezeClock(page);

  // Step 1: a visitor with no session is sent to the welcome screen.
  await page.goto('/');
  await expect(page).toHaveURL('/welcome');
  await expect(page.getByTestId(auth.welcomeStart)).toBeVisible();
  await expectNoA11yViolations(page);
  await shot(page, 'signup-welcome');

  // Step 2: email, the address, continue. The machine time starts at the first press.
  const startedAt = Date.now();
  await page.getByTestId(auth.welcomeStart).click();
  await page.getByTestId(auth.emailOption).click();
  await page.getByTestId(auth.emailField).fill(email);
  await page.getByTestId(auth.emailContinue).click();
  await expect(page.getByTestId(auth.codeField)).toBeVisible();
  const url = page.url();
  const urlHoldsEmail = url.includes(email) || url.includes(encodeURIComponent(email));
  expect(urlHoldsEmail, 'the URL holds no email').toBe(false);
  await expectNoA11yViolations(page);
  await shot(page, 'signup-code');

  // Step 3: the code from the dev mailbox; the field sends it at the sixth digit. The web has no
  // store signal and sign-up asks no age (D-897): the one box to agree follows (D-900), and no
  // session exists yet.
  const code = await readCode(page.request, email);
  await page.getByTestId(auth.codeField).fill(code);
  const agree = page.getByTestId(onboarding.termsAgree);
  const proceedToAccount = page.getByTestId(onboarding.termsContinue);
  await expect(agree).toBeVisible();
  expect((await readMe(page)).status, 'no session before the sign-up details').toBe(401);
  await expect(page.locator('[data-testid^="onboarding.age"]'), 'no age is asked').toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('auth:agree.title'));

  // Step 4: the box is a checkbox with the sentence as its name. It is not ticked for the person,
  // and Continue waits for the tick. The sentence names both documents; they are links only where
  // the pages are served over https, which this stack does not do.
  await expect(page.getByRole('checkbox', { name: t('auth:agree.labelText') })).toHaveCount(1);
  await expect(agree).toHaveRole('checkbox');
  await expect(agree).toHaveAccessibleName(t('auth:agree.labelText'));
  await expect(agree).not.toBeChecked();
  await expect(proceedToAccount).toBeDisabled();
  await expect(page.getByText(t('auth:agree.labelText'), { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid*="ai-consent"]'), 'no AI question').toHaveCount(0);
  await expect(page.getByText(/\bAI\b|Anthropic/), 'no AI notice').toHaveCount(0);
  await expectNoA11yViolations(page);
  await shot(page, 'signup-consent');

  // Step 5: tick the box, then Continue. The sentence's words take no press, so the links in them
  // are pressed alone: the press lands on the box, the square at the row's start. The three
  // documents are recorded with the account (D-351, D-900).
  const row = await agree.boundingBox();
  if (row === null) {
    throw new Error('the box to agree has no place on the page');
  }
  await agree.click({ position: { x: row.height / 2, y: row.height / 2 } });
  await expect(agree).toBeChecked();
  expect((await readMe(page)).status, 'the tick alone makes no account').toBe(401);
  await expect(proceedToAccount).toBeEnabled();
  await proceedToAccount.click();
  await expect(page.getByTestId(onboarding.photoSkip)).toBeVisible();
  await expect(page.locator('[data-testid*="ai-consent"]'), 'no AI question').toHaveCount(0);
  const consented = await signedInMe(page);
  for (const agreement of [
    consented.consents.terms,
    consented.consents.contentPolicy,
    consented.consents.privacyPolicy,
  ]) {
    expect(agreement.agreedVersion).not.toBeNull();
    expect(agreement.agreedVersion).toBe(agreement.currentVersion);
  }
  expect(consented.consents.needed).toEqual([]);
  expect(consented.consents, 'no AI-screening answer is held').not.toHaveProperty('aiScreening');
  // The account records that no age signal came, and claims no result.
  expect(consented.age?.method).toBe('none');
  expect(consented.age?.sourceTier).toBeNull();
  await expectNoA11yViolations(page);

  // Step 6: skipping is as prominent as going on.
  await shot(page, 'signup-photo');
  const skip = page.getByTestId(onboarding.photoSkip);
  const proceed = page.getByTestId(onboarding.photoContinue);
  const [skipBox, proceedBox] = await Promise.all([skip.boundingBox(), proceed.boundingBox()]);
  expect(skipBox?.height, 'Skip is as tall as Continue').toBe(proceedBox?.height);
  await expect(skip).toBeEnabled();
  await expect(skip).toBeInViewport();
  await expect(proceed).toBeInViewport();
  await expectNoA11yViolations(page);

  // Step 6b: skip the photo.
  await skip.click();
  await expect(page.getByTestId(onboarding.handleField)).toBeVisible();
  await expectNoA11yViolations(page);

  // Step 7: a taken handle, then a free one; the field's description is the check's answer.
  const handleField = page.getByTestId(onboarding.handleField);
  await handleField.fill(TAKEN_HANDLE);
  await expect(page.getByTestId(onboarding.handleStatus)).toHaveAccessibleDescription(
    t('onboarding:handle.taken'),
  );
  await handleField.fill(handle);
  await expect(page.getByTestId(onboarding.handleStatus)).toHaveAccessibleDescription(
    t('onboarding:handle.free'),
  );
  await expectNoA11yViolations(page);
  await shot(page, 'signup-handle');
  await page.getByTestId(onboarding.handleContinue).click();

  // Step 8: two picks are not enough.
  const [first, second, third] = PICKS;
  await page.getByTestId(onboarding.issue.id(first)).click();
  await page.getByTestId(onboarding.issue.id(second)).click();
  await expect(page.getByTestId(onboarding.issuesContinue)).toBeDisabled();
  await expectNoA11yViolations(page);

  // Step 8b: a third pick and one star.
  await page.getByTestId(onboarding.issue.id(third)).click();
  const star = page.getByTestId(onboarding.issueStar.id(STARRED));
  await star.click();
  await expect(page.getByTestId(onboarding.issuesContinue)).toBeEnabled();
  await expect(star).toHaveAttribute('aria-checked', 'true');
  await expectNoA11yViolations(page);
  await shot(page, 'signup-issues');

  // Step 8c: on to the location step.
  await page.getByTestId(onboarding.issuesContinue).click();
  await expect(page.getByTestId(onboarding.locationSkip)).toBeVisible();
  await expectNoA11yViolations(page);

  // Step 9: skip the location; sign-up ends on Home, where the machine time stops.
  await page.getByTestId(onboarding.locationSkip).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId(feed.placeholder)).toBeVisible();
  const elapsedMs = Date.now() - startedAt;
  const done = await signedInMe(page);
  expect(done.onboardingStep).toBe('done');
  expect(done.handle === handle, 'the account holds the handle typed').toBe(true);
  expect(done.issues).toHaveLength(PICKS.length);
  expect(done.issues).toEqual(
    expect.arrayContaining(PICKS.map((issueId) => ({ issueId, starred: issueId === STARRED }))),
  );
  await expectNoA11yViolations(page);

  await testInfo.attach('signup-machine-ms', {
    body: String(elapsedMs),
    contentType: 'text/plain',
  });
  expect(elapsedMs, 'sign-up takes under 15 seconds of machine time').toBeLessThan(
    SIGNUP_BUDGET_MS,
  );
});
