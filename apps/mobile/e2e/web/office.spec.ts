/// <reference lib="dom" />
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { EmailStartResultSchema, MeSchema } from '@citizenrun/shared';
import type { StartEmailSignInBody, VerifyEmailSignInBody } from '@citizenrun/shared';
import { expect, test } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';
import { z } from 'zod';

import { SELECTORS } from '../selectors.ts';
import { expectNoA11yViolations } from './helpers/a11y.ts';
import { apiHeaders, operationPath } from './helpers/api.ts';
import { cards, common } from './helpers/catalog.ts';
import { freezeClock } from './helpers/clock.ts';
import { readCode } from './helpers/mailbox.ts';
import { shot } from './helpers/shot.ts';

// TEST-e2e-office: the office page of a seeded office with a known deadline, its sources, Follow and
// Bookmark, and an office whose pay is not known, as seed user 01 in all four projects.

const { office } = SELECTORS;

const JOURNEY_TIMEOUT_MS = 90_000;
/** How soon a press shows its done state: before the server has answered (00 section 8.7). */
const OPTIMISTIC_MS = 1_000;
/** The seed user every step is signed in as, and the one client address it sends (TC-26). */
const SEED_USER = { handle: 'seed_user_01', email: 'seed_user_01@example.test' } as const;
const SEED_USER_ADDRESS = '198.51.100.101';
const MOBILE_DIR = resolve(import.meta.dirname, '../..');
/** The seeded stack's facts (TC-33), written at each start of the stack. */
const SEED_FACTS_FILE = resolve(MOBILE_DIR, 'e2e/.stack/seed-facts.json');
/** The saved session of the seed user, shared by the four projects; git-ignored. */
const STATE_FILE = resolve(MOBILE_DIR, `e2e/.auth/${SEED_USER.handle}.json`);
/** The act-on fields: each shows its source and confidence or the words "not known yet". */
const ACT_ON_FIELDS = [
  'payAmountCents',
  'filingFeeCents',
  'signaturesRequired',
  'whereToFile',
  'filingDeadline',
] as const;
type ActOnField = (typeof ACT_ON_FIELDS)[number];
/** The source rows of each field's section: the pay section's, or the filing section's and the deadline's. */
const SECTION_ROWS: Readonly<Record<ActOnField, string>> = {
  payAmountCents: `[data-testid^="${office.sourceLink.id('pay-')}"]`,
  filingFeeCents: filingRows(),
  signaturesRequired: filingRows(),
  whereToFile: filingRows(),
  filingDeadline: filingRows(),
};
/** A date a source was checked on, as a source line words it. */
const CHECKED = /Checked [A-Z][a-z]{2} \d{1,2}/g;

const SeedFactsSchema = z.object({
  durhamPoint: z.object({ lat: z.number(), lng: z.number() }),
  officeWithDeadline: z.string().min(1),
  officeNotKnown: z.string().min(1),
});
const OfficeIdSchema = z.object({ id: z.string().min(1) });

function filingRows(): string {
  return [
    `[data-testid^="${office.sourceLink.id('filing-')}"]`,
    `[data-testid="${office.sourceLink.id('deadline')}"]`,
  ].join(', ');
}

/** The seed facts; a missing file or key fails the journey. */
function seedFacts(): z.infer<typeof SeedFactsSchema> {
  return SeedFactsSchema.parse(JSON.parse(readFileSync(SEED_FACTS_FILE, 'utf8')));
}

/** An operation's path with its one path parameter filled in. */
function pathOf(operationId: string, value: string): string {
  return operationPath(operationId).replace(/\{[^}]+\}/, encodeURIComponent(value));
}

/** Whether the saved session still answers as the seed user: a reseeded stack ends it. */
async function stateIsValid(browser: Browser, baseURL: string): Promise<boolean> {
  if (!existsSync(STATE_FILE)) {
    return false;
  }
  const context = await browser.newContext({
    baseURL,
    storageState: STATE_FILE,
    extraHTTPHeaders: { 'x-real-ip': SEED_USER_ADDRESS },
  });
  try {
    const page = await context.newPage();
    const response = await context.request.get(operationPath('getMe'), {
      headers: await apiHeaders(page),
    });
    if (response.status() !== 200) {
      return false;
    }
    return MeSchema.parse(await response.json()).handle === SEED_USER.handle;
  } finally {
    await context.close();
  }
}

/**
 * The seed user's saved session, signed in once for the four projects through the real email-code
 * routes, the code read from the dev mailbox (10 section 6.1 rule 2). Nothing typed is printed.
 */
async function seedUserState(browser: Browser, baseURL: string | undefined): Promise<string> {
  if (baseURL === undefined) {
    throw new Error('The project has no base URL');
  }
  if (await stateIsValid(browser, baseURL)) {
    return STATE_FILE;
  }
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-real-ip': SEED_USER_ADDRESS },
  });
  try {
    const page = await context.newPage();
    const headers = await apiHeaders(page);
    const { request } = context;
    const startBody: StartEmailSignInBody = { email: SEED_USER.email };
    const started = await request.post(operationPath('startEmailSignIn'), {
      headers,
      data: startBody,
    });
    expect(started.status(), 'E-AUTH-01 starts the sign-in').toBe(200);
    const { pendingToken } = EmailStartResultSchema.parse(await started.json());
    const code = await readCode(request, SEED_USER.email);
    const verifyBody: VerifyEmailSignInBody = { pendingToken, code, intent: 'sign_in' };
    const verified = await request.post(operationPath('verifyEmailSignIn'), {
      headers,
      data: verifyBody,
    });
    expect(verified.status(), 'E-AUTH-02 signs the seed user in').toBe(200);
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    await context.storageState({ path: STATE_FILE });
  } finally {
    await context.close();
  }
  return STATE_FILE;
}

test.use({
  extraHTTPHeaders: { 'x-real-ip': SEED_USER_ADDRESS },
  storageState: async ({ browser, baseURL }, use) => {
    await use(await seedUserState(browser, baseURL));
  },
});

/** Whether a text holds one of the three confidence words, and which. */
function confidenceIn(text: string): string | null {
  const { high, medium, low } = common.ui.confidence;
  return [high, medium, low].find((word) => text.includes(word)) ?? null;
}

function saysNotKnown(text: string): boolean {
  return text.toLowerCase().includes(common.notKnownYet.toLowerCase());
}

/**
 * An act-on field passes when it says "not known yet", when its section shows a source row with
 * its confidence, or when pressing it opens the sources sheet with a confidence and, above the low
 * one, an `https` link.
 */
async function unknownOrSourced(page: Page, field: ActOnField): Promise<void> {
  const element = page.getByTestId(office.field.id(field));
  await expect(element, field).toBeVisible();
  if (saysNotKnown(await element.innerText())) {
    return;
  }
  const rows = await page.locator(SECTION_ROWS[field]).allInnerTexts();
  if (rows.some((text) => confidenceIn(text) !== null)) {
    return;
  }
  await element.click();
  const sheet = page.getByTestId(office.sourcesSheet);
  await expect(sheet, `${field} opens its sources`).toBeVisible();
  const word = confidenceIn(await sheet.innerText());
  expect(word, `${field} shows the confidence of its source`).not.toBeNull();
  if (word !== common.ui.confidence.low) {
    const hrefs = await sheet
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(
      hrefs.some((href) => href.startsWith('https://')),
      `${field} links its source`,
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

/** Scrolls every scrolling element of the page, and the window, to its end or back to its top. */
async function scrollPage(page: Page, to: 'end' | 'top'): Promise<void> {
  await page.evaluate((where) => {
    const scrollers = [...document.querySelectorAll<HTMLElement>('*')].filter((element) => {
      const { overflowY } = getComputedStyle(element);
      return (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight
      );
    });
    for (const scroller of scrollers) {
      scroller.scrollTop = where === 'end' ? scroller.scrollHeight : 0;
    }
    window.scrollTo(0, where === 'end' ? document.documentElement.scrollHeight : 0);
  }, to);
}

async function boxOf(
  locator: Locator,
  name: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${name} has no box`);
  }
  return box;
}

/**
 * Holds every request of `method` to a path ending in `suffix` until the returned function is
 * called, so a journey sees what the page shows before the server answers.
 */
async function holdRequests(page: Page, method: string, suffix: string): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  await page.route(
    (url) => url.pathname.endsWith(suffix),
    async (route) => {
      if (route.request().method() !== method) {
        await route.fallback();
        return;
      }
      await gate;
      await route.continue();
    },
  );
  return release;
}

/** Undoes the seed user's follow and bookmark of the office, so every project starts clean. */
async function resetToggles(page: Page, slug: string): Promise<string> {
  const { request } = page.context();
  const headers = await apiHeaders(page);
  const found = await request.get(pathOf('getOffice', slug), { headers });
  expect(found.status(), 'E-OFF-01 answers the office').toBe(200);
  const { id } = OfficeIdSchema.parse(await found.json());
  for (const operation of ['unfollowOffice', 'unbookmarkOffice']) {
    const response = await request.delete(pathOf(operation, id), { headers });
    expect(response.ok(), `${operation} answers`).toBe(true);
  }
  return id;
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await freezeClock(page);
});

test('step 1: the office page shows the deal and every act-on field', async ({
  page,
}, testInfo) => {
  const { officeWithDeadline } = seedFacts();
  await page.goto(`/office/${officeWithDeadline}`);
  await expect(page.getByTestId(office.dealLine)).toBeVisible();
  // The page is shot with the office neither followed nor bookmarked, whatever ran before.
  await resetToggles(page, officeWithDeadline);
  await page.reload();
  const deal = page.getByTestId(office.dealLine);
  await expect(deal).toBeVisible();
  await expect(page.getByTestId(office.followButton)).toHaveText(common.ui.actions.follow);
  await expect(page.getByTestId(office.bookmarkButton)).toHaveAccessibleName(
    common.ui.actions.bookmark,
  );
  for (const field of ACT_ON_FIELDS) {
    await unknownOrSourced(page, field);
  }
  // Run is not drawn (00 section 13.4).
  await expect(page.getByTestId(office.runButton)).toHaveCount(0);

  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('The project has no viewport');
  }
  if (testInfo.project.name.startsWith('desktop')) {
    // Two columns, the action card in the right one, and it stays in view.
    const card = page.getByTestId(office.actionCard);
    await expect(card).toBeVisible();
    const dealBox = await boxOf(deal, office.dealLine);
    expect((await boxOf(card, office.actionCard)).x).toBeGreaterThanOrEqual(
      dealBox.x + dealBox.width,
    );
    await scrollPage(page, 'end');
    await expect
      .poll(
        async () => {
          const box = await boxOf(card, office.actionCard);
          return box.y >= 0 && box.y + box.height <= viewport.height;
        },
        { message: 'the action card stays in the viewport at the end of the page' },
      )
      .toBe(true);
    await scrollPage(page, 'top');
  } else {
    // The bar of actions sticks to the bottom of the screen.
    const actions = page.getByTestId(office.actions);
    await expect(actions).toBeVisible();
    const box = await boxOf(actions, office.actions);
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
  }
  await expectNoA11yViolations(page);
  await shot(page, 'office-top');
});

test('step 2: the sources sheet links each source with its date', async ({ page }) => {
  const { officeWithDeadline } = seedFacts();
  await page.goto(`/office/${officeWithDeadline}`);
  await expect(page.getByTestId(office.dealLine)).toBeVisible();
  await page.getByTestId(office.sourcesOpen.id('1')).click();
  const sheet = page.getByTestId(office.sourcesSheet);
  await expect(sheet).toBeVisible();
  const hrefs = await sheet
    .locator('a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.length, 'the sheet links its sources').toBeGreaterThan(0);
  expect(hrefs.filter((href) => !href.startsWith('https://'))).toEqual([]);
  // Each entry shows its confidence in words and the date its source was checked.
  const text = await sheet.innerText();
  const { high, medium, low } = common.ui.confidence;
  const entries = [high, medium, low].reduce(
    (count, word) => count + text.split(word).length - 1,
    0,
  );
  expect(entries, 'the sheet lists its sources').toBeGreaterThan(0);
  expect(text.match(CHECKED)?.length ?? 0).toBeGreaterThanOrEqual(entries);
  await expect(sheet.getByText(common.confirmBeforeFiling, { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  await shot(page, 'office-sources');
});

test('step 3: Follow and Bookmark change at once and persist', async ({ page }) => {
  const { officeWithDeadline } = seedFacts();
  await page.goto(`/office/${officeWithDeadline}`);
  await expect(page.getByTestId(office.dealLine)).toBeVisible();
  const officeId = await resetToggles(page, officeWithDeadline);
  try {
    await page.reload();
    const follow = page.getByTestId(office.followButton);
    const bookmark = page.getByTestId(office.bookmarkButton);
    await expect(follow).toHaveText(common.ui.actions.follow);
    await expect(bookmark).toHaveAccessibleName(common.ui.actions.bookmark);

    // Each press shows its done state while its request is still held back.
    const releaseFollow = await holdRequests(page, 'POST', `/${officeId}/follow`);
    const followed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(`/${officeId}/follow`),
    );
    await follow.click();
    await expect(follow).toHaveText(common.ui.actions.following, { timeout: OPTIMISTIC_MS });
    releaseFollow();
    expect((await followed).ok(), 'E-OFF-04 answers').toBe(true);

    const releaseBookmark = await holdRequests(page, 'POST', `/${officeId}/bookmark`);
    const bookmarked = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith(`/${officeId}/bookmark`),
    );
    await bookmark.click();
    await expect(bookmark).toHaveAccessibleName(common.ui.actions.bookmarked, {
      timeout: OPTIMISTIC_MS,
    });
    releaseBookmark();
    expect((await bookmarked).ok(), 'E-OFF-06 answers').toBe(true);
    await page.unrouteAll({ behavior: 'wait' });

    await page.reload();
    await expect(page.getByTestId(office.followButton)).toHaveText(common.ui.actions.following);
    await expect(page.getByTestId(office.bookmarkButton)).toHaveAccessibleName(
      common.ui.actions.bookmarked,
    );
    await expectNoA11yViolations(page);
  } finally {
    await resetToggles(page, officeWithDeadline);
  }
});

test('step 4: an office whose pay is not known says so', async ({ page }) => {
  const { officeNotKnown } = seedFacts();
  await page.goto(`/office/${officeNotKnown}`);
  const deal = page.getByTestId(office.dealLine);
  await expect(deal).toBeVisible();
  const pay = page.getByTestId(office.field.id('payAmountCents'));
  await expect(pay).toContainText(common.notKnownYet, { ignoreCase: true });
  await expect(deal).toContainText(cards.deal.payUnknown);
  await expectNoA11yViolations(page);
  await shot(page, 'office-not-known');
});
