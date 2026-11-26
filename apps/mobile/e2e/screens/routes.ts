import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** A viewport of the capture, as its projects name it. */
export type ScreenViewport = '360x740' | '430x932' | '820x1180' | '1440x900';

export type ScreenEntry = {
  id: string;
  path: string;
  auth: 'none' | 'user';
  /** The viewports the entry is captured at; every viewport when it names none. */
  viewports?: readonly ScreenViewport[];
  prepare?: (page: Page) => Promise<void>;
};

/** The gallery has drawn its controls. */
async function waitForGallery(page: Page): Promise<void> {
  await expect(page.getByTestId('gallery.theme-system')).toBeVisible();
}

/** The gallery has drawn the one section its address names, and no note that there is none of that name. */
async function waitForGallerySection(page: Page): Promise<void> {
  await waitForGallery(page);
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.getByText(/^No component named/)).toHaveCount(0);
}

/** A frame that is where it rests: one that never moves, or one that has finished moving. */
const AT_REST = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

/**
 * Opens one sheet or dialog of the gallery with the gallery's own button, and waits until it has
 * faded in and, for a sheet on a phone, risen to where it rests.
 */
function openGalleryOverlay(overlay: string): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByTestId(`gallery.open-${overlay}`).click();
    await layerAtRest(page.getByTestId(`gallery.${overlay}`));
  };
}

/** A layer over the gallery has faded in and, for a sheet on a phone, risen to where it rests. */
async function layerAtRest(layer: Locator): Promise<void> {
  await layer.waitFor();
  await expect(layer).toHaveCSS('opacity', '1');
  await expect(layer).toHaveCSS('transform', AT_REST);
}

/**
 * Opens one C-Popover specimen of the gallery with its own control, and waits until it has faded
 * in, then moves the pointer to the page's top corner, so no row is drawn under it.
 */
function openGalleryPopover(state: string): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByTestId(`gallery.popover-open-${state}`).click();
    await layerAtRest(page.getByTestId(`gallery.popover-${state}`));
    await page.mouse.move(0, 0);
  };
}

/**
 * Opens one C-Select of the gallery with its own control: its list in a popover on a wide window,
 * in a sheet on a phone. Waits until the list has faded in or risen to where it rests, then moves
 * the pointer to the page's top corner, so no row is drawn under it.
 */
function openGallerySelect(control: string): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByTestId(control).click();
    await layerAtRest(
      page.getByTestId(`${control}-popover`).or(page.getByTestId(`${control}-sheet`)),
    );
    await page.mouse.move(0, 0);
  };
}

/** Shows one toast of the gallery with the gallery's own button, and waits for it. */
function showGalleryToast(state: string): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByTestId(`gallery.show-toast-${state}`).click();
    await page.getByTestId('toast').waitFor();
  };
}

/** Gives the gallery's tooltip specimen the keyboard focus, and waits until its bubble is placed. */
async function focusGalleryTooltip(page: Page): Promise<void> {
  await page.getByTestId('gallery.tooltip-target').focus();
  const bubble = page.getByText('Settings', { exact: true }).locator('..');
  await expect(bubble).toHaveCSS('opacity', '1');
}

/**
 * The map spike has drawn its first frame, or says why it cannot: a headless browser with no WebGL2
 * reads `error map.webgl_unavailable`, which is still a capture.
 */
async function waitForMapSpike(page: Page): Promise<void> {
  await expect(page.getByTestId('dev.map-spike-status')).toHaveText(
    /^(ready \d+|error map\.[a-z_]+)$/,
    { timeout: 60000 },
  );
}

/** The card spike has drawn its card. */
async function waitForCardSpike(page: Page): Promise<void> {
  await page.getByTestId('dev.card-spike-card').waitFor({ state: 'visible', timeout: 30000 });
}

/** The list spike has drawn its first row. */
async function waitForListSpike(page: Page): Promise<void> {
  await page.getByTestId('dev.list-spike-row-0').waitFor({ state: 'visible', timeout: 30000 });
}

/**
 * Taps one chip or star of the issues step that is past its limit, and waits for the footer to say
 * so, then moves the pointer to the page's top corner, so no chip is drawn under it.
 */
function tapPastLimit(testID: string, line: string): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByTestId(testID).click();
    await expect(page.getByText(line, { exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
  };
}

/**
 * Types a handle into the handle step's field and leaves the field, so the capture shows the handle
 * its status line is about. A fixture holds what the check found, not what was typed.
 */
function typeHandle(value: string): (page: Page) => Promise<void> {
  return async (page) => {
    const field = page.getByTestId('onboarding.handle-field');
    await field.fill(value);
    await expect(field).toHaveValue(value);
    await field.blur();
  };
}

/**
 * The time the fixtures are written at: a sign-in code fixture was sent then, 30 seconds before it
 * may be sent again.
 */
const FIXTURE_TIME = '2027-01-15T12:00:00.000Z';

/**
 * Sets the page's clock to the fixtures' own time and waits for the wait to be counted from it, so
 * the capture of a code fixture shows the 30 seconds of a new code, not the distance to today.
 */
async function atFixtureTime(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXTURE_TIME));
  await expect(page.getByTestId('auth.code-resend-live')).toHaveText(/(^|\D)30(\D|$)/);
}

/**
 * The birth question shows the words of both of its selects whole. A select draws its words on one
 * line and cuts short what its width cannot hold, so a capture with a cut word fails here.
 */
async function ageGateWordsWhole(page: Page): Promise<void> {
  for (const testID of ['onboarding.age-month', 'onboarding.age-year']) {
    const select = page.getByTestId(testID);
    await expect(select).toBeVisible();
    const lines = await select.evaluate((control) =>
      Array.from(control.querySelectorAll<HTMLElement>('*'))
        .filter((element) => getComputedStyle(element).textOverflow === 'ellipsis')
        .map((element) => ({
          words: element.textContent,
          cut: element.scrollWidth > element.clientWidth,
        })),
    );
    expect(lines, `${testID} draws its words on one line`).not.toEqual([]);
    expect(
      lines.filter((line) => line.cut).map((line) => line.words),
      `${testID} cuts its words short`,
    ).toEqual([]);
  }
}

/** The re-authentication sheet has faded in and, on a phone, risen to where it rests. */
async function reauthSheetAtRest(page: Page): Promise<void> {
  await layerAtRest(page.getByTestId('auth.reauth-sheet'));
}

/** The sheet at rest with its code stage counted from the fixtures' own time. */
async function reauthCodeAtRest(page: Page): Promise<void> {
  await atFixtureTime(page);
  await reauthSheetAtRest(page);
}

/** The AI-screening question's sheet has faded in and, on a phone, risen to where it rests. */
async function aiConsentSheetAtRest(page: Page): Promise<void> {
  await layerAtRest(page.getByTestId('settings.ai-consent'));
}

/** The add-email sheet has faded in and, on a phone, risen to where it rests. */
async function addEmailSheetAtRest(page: Page): Promise<void> {
  await layerAtRest(page.getByTestId('auth.add-email-sheet'));
}

/**
 * The add-email sheet at rest with its code stage counted from the fixtures' own time: the minute
 * its fixture leaves before another code may be sent, not the distance to today.
 */
async function addEmailCodeAtRest(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXTURE_TIME));
  await expect(page.getByTestId('auth.code-resend-live')).toHaveText(/(^|\D)60(\D|$)/);
  await addEmailSheetAtRest(page);
}

/** The agreements sheet has faded in and, on a phone, risen to where it rests. */
async function agreementsSheetAtRest(page: Page): Promise<void> {
  await layerAtRest(page.getByTestId('system.agreements'));
}

/** The dialog that confirms an account's deletion has faded in. */
async function deleteDialogAtRest(page: Page): Promise<void> {
  await layerAtRest(page.getByTestId('settings.delete-dialog'));
}

/**
 * The export screen counts its wait from the fixtures' own time, not from today: the clock is set
 * and the page is told it has come back into view, which is when the screen reads the time again.
 */
async function exportWaitAtFixtureTime(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXTURE_TIME));
  await page.evaluate(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('settings.export-request')).toContainText('You can request again');
}

export const SCREENS: ScreenEntry[] = [
  // The whole gallery, at either text size, is taller on a phone than one capture takes, so it is
  // captured whole at the two wide viewports only; on the two phones its section entries are the
  // record.
  {
    id: 'dev-gallery',
    path: '/dev/gallery',
    auth: 'none',
    viewports: ['820x1180', '1440x900'],
    prepare: waitForGallery,
  },
  {
    id: 'dev-gallery-text-130',
    path: '/dev/gallery?textScale=1.3',
    auth: 'none',
    viewports: ['820x1180', '1440x900'],
    prepare: waitForGallery,
  },
  // The gallery grows with every component, so the design review captures it one section at a
  // time, in the gallery's order.
  {
    id: 'dev-gallery-section-shells',
    path: '/dev/gallery?only=shells',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-tab-bar',
    path: '/dev/gallery?only=tab-bar',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-rail',
    path: '/dev/gallery?only=rail',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-app-bar',
    path: '/dev/gallery?only=app-bar',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-right-column',
    path: '/dev/gallery?only=right-column',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-text',
    path: '/dev/gallery?only=text',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-pressable',
    path: '/dev/gallery?only=pressable',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-icon',
    path: '/dev/gallery?only=icon',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-link',
    path: '/dev/gallery?only=link',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-rule',
    path: '/dev/gallery?only=rule',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-feed-rule',
    path: '/dev/gallery?only=feed-rule',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-button',
    path: '/dev/gallery?only=button',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-icon-button',
    path: '/dev/gallery?only=icon-button',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-avatar',
    path: '/dev/gallery?only=avatar',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-count-badge',
    path: '/dev/gallery?only=count-badge',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-wordmark',
    path: '/dev/gallery?only=wordmark',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-empty-chair',
    path: '/dev/gallery?only=empty-chair',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-notice',
    path: '/dev/gallery?only=notice',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-skeleton',
    path: '/dev/gallery?only=skeleton',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-empty-state',
    path: '/dev/gallery?only=empty-state',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-screen',
    path: '/dev/gallery?only=screen',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-list',
    path: '/dev/gallery?only=list',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-system-screen',
    path: '/dev/gallery?only=system-screen',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-sheet',
    path: '/dev/gallery?only=sheet',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-dialog',
    path: '/dev/gallery?only=dialog',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-popover',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-tooltip',
    path: '/dev/gallery?only=tooltip',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-toast',
    path: '/dev/gallery?only=toast',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-form-field',
    path: '/dev/gallery?only=form-field',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-text-field',
    path: '/dev/gallery?only=text-field',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-handle-field',
    path: '/dev/gallery?only=handle-field',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-code-field',
    path: '/dev/gallery?only=code-field',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-select',
    path: '/dev/gallery?only=select',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-checkbox',
    path: '/dev/gallery?only=checkbox',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-radio',
    path: '/dev/gallery?only=radio',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-radio-group',
    path: '/dev/gallery?only=radio-group',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-switch',
    path: '/dev/gallery?only=switch',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-age-gate',
    path: '/dev/gallery?only=age-gate',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-progress',
    path: '/dev/gallery?only=progress',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-sticky-footer',
    path: '/dev/gallery?only=sticky-footer',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-section-header',
    path: '/dev/gallery?only=section-header',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-list-row',
    path: '/dev/gallery?only=list-row',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-prose',
    path: '/dev/gallery?only=prose',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-issue-tile',
    path: '/dev/gallery?only=issue-tile',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-issue-chip',
    path: '/dev/gallery?only=issue-chip',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-issue-grid',
    path: '/dev/gallery?only=issue-grid',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  // The gallery at 130% text, one section at a time, as above: the whole of it at that size is
  // taller still.
  {
    id: 'dev-gallery-section-shells-x130',
    path: '/dev/gallery?only=shells&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-tab-bar-x130',
    path: '/dev/gallery?only=tab-bar&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-rail-x130',
    path: '/dev/gallery?only=rail&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-app-bar-x130',
    path: '/dev/gallery?only=app-bar&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-right-column-x130',
    path: '/dev/gallery?only=right-column&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-text-x130',
    path: '/dev/gallery?only=text&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-pressable-x130',
    path: '/dev/gallery?only=pressable&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-icon-x130',
    path: '/dev/gallery?only=icon&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-link-x130',
    path: '/dev/gallery?only=link&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-rule-x130',
    path: '/dev/gallery?only=rule&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-feed-rule-x130',
    path: '/dev/gallery?only=feed-rule&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-button-x130',
    path: '/dev/gallery?only=button&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-icon-button-x130',
    path: '/dev/gallery?only=icon-button&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-avatar-x130',
    path: '/dev/gallery?only=avatar&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-count-badge-x130',
    path: '/dev/gallery?only=count-badge&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-wordmark-x130',
    path: '/dev/gallery?only=wordmark&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-empty-chair-x130',
    path: '/dev/gallery?only=empty-chair&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-notice-x130',
    path: '/dev/gallery?only=notice&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-skeleton-x130',
    path: '/dev/gallery?only=skeleton&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-empty-state-x130',
    path: '/dev/gallery?only=empty-state&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-screen-x130',
    path: '/dev/gallery?only=screen&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-list-x130',
    path: '/dev/gallery?only=list&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-system-screen-x130',
    path: '/dev/gallery?only=system-screen&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-sheet-x130',
    path: '/dev/gallery?only=sheet&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-dialog-x130',
    path: '/dev/gallery?only=dialog&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-popover-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-tooltip-x130',
    path: '/dev/gallery?only=tooltip&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-toast-x130',
    path: '/dev/gallery?only=toast&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-form-field-x130',
    path: '/dev/gallery?only=form-field&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-text-field-x130',
    path: '/dev/gallery?only=text-field&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-handle-field-x130',
    path: '/dev/gallery?only=handle-field&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-code-field-x130',
    path: '/dev/gallery?only=code-field&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-select-x130',
    path: '/dev/gallery?only=select&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-checkbox-x130',
    path: '/dev/gallery?only=checkbox&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-radio-x130',
    path: '/dev/gallery?only=radio&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-radio-group-x130',
    path: '/dev/gallery?only=radio-group&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-switch-x130',
    path: '/dev/gallery?only=switch&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-age-gate-x130',
    path: '/dev/gallery?only=age-gate&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-progress-x130',
    path: '/dev/gallery?only=progress&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-sticky-footer-x130',
    path: '/dev/gallery?only=sticky-footer&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-section-header-x130',
    path: '/dev/gallery?only=section-header&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-list-row-x130',
    path: '/dev/gallery?only=list-row&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-prose-x130',
    path: '/dev/gallery?only=prose&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-issue-tile-x130',
    path: '/dev/gallery?only=issue-tile&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-issue-chip-x130',
    path: '/dev/gallery?only=issue-chip&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  {
    id: 'dev-gallery-section-issue-grid-x130',
    path: '/dev/gallery?only=issue-grid&textScale=1.3',
    auth: 'none',
    prepare: waitForGallerySection,
  },
  // Each overlay is captured over its own section of the gallery: the whole gallery behind an
  // overlay would be captured again, one screen at a time.
  {
    id: 'dev-gallery-sheet-open',
    path: '/dev/gallery?only=sheet',
    auth: 'none',
    prepare: openGalleryOverlay('sheet-open'),
  },
  {
    id: 'dev-gallery-dialog-confirm',
    path: '/dev/gallery?only=dialog',
    auth: 'none',
    prepare: openGalleryOverlay('dialog-confirm'),
  },
  {
    id: 'dev-gallery-dialog-destructive',
    path: '/dev/gallery?only=dialog',
    auth: 'none',
    prepare: openGalleryOverlay('dialog-destructive'),
  },
  {
    id: 'dev-gallery-dialog-large',
    path: '/dev/gallery?only=dialog',
    auth: 'none',
    prepare: openGalleryOverlay('dialog-large'),
  },
  {
    id: 'dev-gallery-toast-success',
    path: '/dev/gallery?only=toast',
    auth: 'none',
    prepare: showGalleryToast('success'),
  },
  {
    id: 'dev-gallery-toast-error',
    path: '/dev/gallery?only=toast',
    auth: 'none',
    prepare: showGalleryToast('error'),
  },
  {
    id: 'dev-gallery-tooltip',
    path: '/dev/gallery?only=tooltip',
    auth: 'none',
    prepare: focusGalleryTooltip,
  },
  {
    id: 'dev-gallery-popover-below-start',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('below-start'),
  },
  {
    id: 'dev-gallery-popover-below-end',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('below-end'),
  },
  {
    id: 'dev-gallery-popover-above-start',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('above-start'),
  },
  {
    id: 'dev-gallery-popover-above-end',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('above-end'),
  },
  {
    id: 'dev-gallery-popover-end',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('end'),
  },
  {
    id: 'dev-gallery-popover-padded',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('padded'),
  },
  {
    id: 'dev-gallery-popover-narrow-anchor',
    path: '/dev/gallery?only=popover',
    auth: 'none',
    prepare: openGalleryPopover('narrow-anchor'),
  },
  {
    id: 'dev-gallery-select-long-list',
    path: '/dev/gallery?only=select',
    auth: 'none',
    prepare: openGallerySelect('gallery.select-long-list'),
  },
  {
    id: 'dev-gallery-age-gate-month',
    path: '/dev/gallery?only=age-gate',
    auth: 'none',
    prepare: openGallerySelect('gallery.age-gate-empty-month'),
  },
  // Each overlay again at 130% text: the section entries at that size show only its opener.
  {
    id: 'dev-gallery-sheet-open-x130',
    path: '/dev/gallery?only=sheet&textScale=1.3',
    auth: 'none',
    prepare: openGalleryOverlay('sheet-open'),
  },
  {
    id: 'dev-gallery-dialog-confirm-x130',
    path: '/dev/gallery?only=dialog&textScale=1.3',
    auth: 'none',
    prepare: openGalleryOverlay('dialog-confirm'),
  },
  {
    id: 'dev-gallery-dialog-destructive-x130',
    path: '/dev/gallery?only=dialog&textScale=1.3',
    auth: 'none',
    prepare: openGalleryOverlay('dialog-destructive'),
  },
  {
    id: 'dev-gallery-dialog-large-x130',
    path: '/dev/gallery?only=dialog&textScale=1.3',
    auth: 'none',
    prepare: openGalleryOverlay('dialog-large'),
  },
  {
    id: 'dev-gallery-toast-success-x130',
    path: '/dev/gallery?only=toast&textScale=1.3',
    auth: 'none',
    prepare: showGalleryToast('success'),
  },
  {
    id: 'dev-gallery-toast-error-x130',
    path: '/dev/gallery?only=toast&textScale=1.3',
    auth: 'none',
    prepare: showGalleryToast('error'),
  },
  {
    id: 'dev-gallery-tooltip-x130',
    path: '/dev/gallery?only=tooltip&textScale=1.3',
    auth: 'none',
    prepare: focusGalleryTooltip,
  },
  {
    id: 'dev-gallery-popover-below-start-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('below-start'),
  },
  {
    id: 'dev-gallery-popover-below-end-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('below-end'),
  },
  {
    id: 'dev-gallery-popover-above-start-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('above-start'),
  },
  {
    id: 'dev-gallery-popover-above-end-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('above-end'),
  },
  {
    id: 'dev-gallery-popover-end-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('end'),
  },
  {
    id: 'dev-gallery-popover-padded-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('padded'),
  },
  {
    id: 'dev-gallery-popover-narrow-anchor-x130',
    path: '/dev/gallery?only=popover&textScale=1.3',
    auth: 'none',
    prepare: openGalleryPopover('narrow-anchor'),
  },
  {
    id: 'dev-gallery-select-long-list-x130',
    path: '/dev/gallery?only=select&textScale=1.3',
    auth: 'none',
    prepare: openGallerySelect('gallery.select-long-list'),
  },
  {
    id: 'dev-gallery-age-gate-month-x130',
    path: '/dev/gallery?only=age-gate&textScale=1.3',
    auth: 'none',
    prepare: openGallerySelect('gallery.age-gate-empty-month'),
  },
  {
    id: 'root-layout-root-starting',
    path: '/dev/screens/root-layout/rootStarting',
    auth: 'none',
  },
  {
    id: 'root-layout-root-signed-out',
    path: '/dev/screens/root-layout/rootSignedOut',
    auth: 'none',
  },
  {
    id: 'root-layout-root-signed-in',
    path: '/dev/screens/root-layout/rootSignedIn',
    auth: 'none',
  },
  { id: 'root-layout-root-update', path: '/dev/screens/root-layout/rootUpdate', auth: 'none' },
  {
    id: 'root-layout-root-adults-only',
    path: '/dev/screens/root-layout/rootAdultsOnly',
    auth: 'none',
  },
  {
    id: 'root-layout-root-agreements',
    path: '/dev/screens/root-layout/rootAgreements',
    auth: 'none',
    prepare: agreementsSheetAtRest,
  },
  {
    id: 'not-found-not-found-default',
    path: '/dev/screens/not-found/notFoundDefault',
    auth: 'none',
  },
  {
    id: 'system-update-update-with-store',
    path: '/dev/screens/system-update/updateWithStore',
    auth: 'none',
  },
  {
    id: 'system-update-update-no-store',
    path: '/dev/screens/system-update/updateNoStore',
    auth: 'none',
  },
  {
    id: 'system-error-system-error',
    path: '/dev/screens/system-error/systemError',
    auth: 'none',
  },
  // The sign-up steps. A tight layout is a phone's own text size, which a browser does not have,
  // so the tight fixture is drawn at 130% text. The two limit lines show after one more tap, and a
  // handle's status line is drawn under a typed handle.
  {
    id: 'onboarding-photo-photo-none',
    path: '/dev/screens/onboarding-photo/photoNone',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-ready',
    path: '/dev/screens/onboarding-photo/photoReady',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-uploading',
    path: '/dev/screens/onboarding-photo/photoUploading',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-photos-blocked',
    path: '/dev/screens/onboarding-photo/photoFailedPhotosBlocked',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-unsupported-format',
    path: '/dev/screens/onboarding-photo/photoFailedUnsupportedFormat',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-photo-too-large',
    path: '/dev/screens/onboarding-photo/photoFailedPhotoTooLarge',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-prepare-failed',
    path: '/dev/screens/onboarding-photo/photoFailedPrepareFailed',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-upload-failed',
    path: '/dev/screens/onboarding-photo/photoFailedUploadFailed',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-rate-limited',
    path: '/dev/screens/onboarding-photo/photoFailedRateLimited',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-failed-generic',
    path: '/dev/screens/onboarding-photo/photoFailedGeneric',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-skipping',
    path: '/dev/screens/onboarding-photo/photoSkipping',
    auth: 'none',
  },
  {
    id: 'onboarding-photo-photo-offline',
    path: '/dev/screens/onboarding-photo/photoOffline',
    auth: 'none',
  },
  {
    id: 'onboarding-handle-handle-empty',
    path: '/dev/screens/onboarding-handle/handleEmpty',
    auth: 'none',
  },
  {
    id: 'onboarding-handle-handle-checking',
    path: '/dev/screens/onboarding-handle/handleChecking',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-handle-handle-free',
    path: '/dev/screens/onboarding-handle/handleFree',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-handle-handle-taken',
    path: '/dev/screens/onboarding-handle/handleTaken',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-handle-handle-reserved',
    path: '/dev/screens/onboarding-handle/handleReserved',
    auth: 'none',
    prepare: typeHandle('admin'),
  },
  {
    id: 'onboarding-handle-handle-too-short',
    path: '/dev/screens/onboarding-handle/handleTooShort',
    auth: 'none',
    prepare: typeHandle('ab'),
  },
  {
    id: 'onboarding-handle-handle-too-long',
    path: '/dev/screens/onboarding-handle/handleTooLong',
    auth: 'none',
  },
  {
    id: 'onboarding-handle-handle-characters',
    path: '/dev/screens/onboarding-handle/handleCharacters',
    auth: 'none',
  },
  {
    id: 'onboarding-handle-handle-dots',
    path: '/dev/screens/onboarding-handle/handleDots',
    auth: 'none',
    prepare: typeHandle('.test'),
  },
  {
    id: 'onboarding-handle-handle-no-letter',
    path: '/dev/screens/onboarding-handle/handleNoLetter',
    auth: 'none',
    prepare: typeHandle('_._'),
  },
  {
    id: 'onboarding-handle-handle-sending',
    path: '/dev/screens/onboarding-handle/handleSending',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-handle-handle-race',
    path: '/dev/screens/onboarding-handle/handleRace',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-handle-handle-change-too-soon',
    path: '/dev/screens/onboarding-handle/handleChangeTooSoon',
    auth: 'none',
  },
  {
    id: 'onboarding-handle-handle-check-failed',
    path: '/dev/screens/onboarding-handle/handleCheckFailed',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-handle-handle-offline',
    path: '/dev/screens/onboarding-handle/handleOffline',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-issues-issues-loading',
    path: '/dev/screens/onboarding-issues/issuesLoading',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-error',
    path: '/dev/screens/onboarding-issues/issuesError',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-offline',
    path: '/dev/screens/onboarding-issues/issuesOffline',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-none',
    path: '/dev/screens/onboarding-issues/issuesNone',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-two',
    path: '/dev/screens/onboarding-issues/issuesTwo',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-five',
    path: '/dev/screens/onboarding-issues/issuesFive',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-ten',
    path: '/dev/screens/onboarding-issues/issuesTen',
    auth: 'none',
    prepare: tapPastLimit('onboarding.issue-schools', '10 is the most'),
  },
  {
    id: 'onboarding-issues-issues-star-limit',
    path: '/dev/screens/onboarding-issues/issuesStarLimit',
    auth: 'none',
    prepare: tapPastLimit('onboarding.issue-property-taxes-star', '3 stars is the most'),
  },
  {
    id: 'onboarding-issues-issues-sending',
    path: '/dev/screens/onboarding-issues/issuesSending',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-submit-error',
    path: '/dev/screens/onboarding-issues/issuesSubmitError',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-tight',
    path: '/dev/screens/onboarding-issues/issuesTight?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'onboarding-location-location-soon',
    path: '/dev/screens/onboarding-location/locationSoon',
    auth: 'none',
  },
  {
    id: 'onboarding-location-location-soon-sending',
    path: '/dev/screens/onboarding-location/locationSoonSending',
    auth: 'none',
  },
  {
    id: 'onboarding-location-location-soon-error',
    path: '/dev/screens/onboarding-location/locationSoonError',
    auth: 'none',
  },
  {
    id: 'onboarding-location-location-soon-offline',
    path: '/dev/screens/onboarding-location/locationSoonOffline',
    auth: 'none',
  },
  // Welcome, sign-in and the two screens that stand in place of sign-in. A code fixture counts its
  // wait from the fixtures' own time, so its capture is taken at that time.
  {
    id: 'welcome-welcome-default',
    path: '/dev/screens/welcome/welcomeDefault',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-methods',
    path: '/dev/screens/sign-in/signInMethods',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-methods-email-only',
    path: '/dev/screens/sign-in/signInMethodsEmailOnly',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-methods-busy',
    path: '/dev/screens/sign-in/signInMethodsBusy',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-methods-notice',
    path: '/dev/screens/sign-in/signInMethodsNotice',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-email',
    path: '/dev/screens/sign-in/signInEmail',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-email-sending',
    path: '/dev/screens/sign-in/signInEmailSending',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-email-error',
    path: '/dev/screens/sign-in/signInEmailError',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-code',
    path: '/dev/screens/sign-in/signInCode',
    auth: 'none',
    prepare: atFixtureTime,
  },
  {
    id: 'sign-in-sign-in-code-checking',
    path: '/dev/screens/sign-in/signInCodeChecking',
    auth: 'none',
    prepare: atFixtureTime,
  },
  {
    id: 'sign-in-sign-in-code-wrong',
    path: '/dev/screens/sign-in/signInCodeWrong',
    auth: 'none',
    prepare: atFixtureTime,
  },
  {
    id: 'sign-in-sign-in-code-locked',
    path: '/dev/screens/sign-in/signInCodeLocked',
    auth: 'none',
    prepare: atFixtureTime,
  },
  {
    id: 'sign-in-sign-in-code-expired',
    path: '/dev/screens/sign-in/signInCodeExpired',
    auth: 'none',
    prepare: atFixtureTime,
  },
  {
    id: 'sign-in-sign-in-code-resend-limited',
    path: '/dev/screens/sign-in/signInCodeResendLimited',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-checking-age',
    path: '/dev/screens/sign-in/signInCheckingAge',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-finishing',
    path: '/dev/screens/sign-in/signInFinishing',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-age-gate',
    path: '/dev/screens/sign-in/signInAgeGate',
    auth: 'none',
    prepare: ageGateWordsWhole,
  },
  {
    id: 'sign-in-sign-in-age-gate-incomplete',
    path: '/dev/screens/sign-in/signInAgeGateIncomplete',
    auth: 'none',
    prepare: ageGateWordsWhole,
  },
  {
    id: 'sign-in-sign-in-state',
    path: '/dev/screens/sign-in/signInState',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-agreements',
    path: '/dev/screens/sign-in/signInAgreements',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-ai-consent',
    path: '/dev/screens/sign-in/signInAiConsent',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-adults-only',
    path: '/dev/screens/sign-in/signInAdultsOnly',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-state-unavailable',
    path: '/dev/screens/sign-in/signInStateUnavailable',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-offline',
    path: '/dev/screens/sign-in/signInOffline',
    auth: 'none',
  },
  // The re-authentication sheet, drawn over the route's ground once it is where it rests.
  {
    id: 'sign-in-reauth-reauth-methods',
    path: '/dev/screens/sign-in-reauth/reauthMethods',
    auth: 'none',
    prepare: reauthSheetAtRest,
  },
  {
    id: 'sign-in-reauth-reauth-code',
    path: '/dev/screens/sign-in-reauth/reauthCode',
    auth: 'none',
    prepare: reauthCodeAtRest,
  },
  {
    id: 'sign-in-reauth-reauth-code-wrong',
    path: '/dev/screens/sign-in-reauth/reauthCodeWrong',
    auth: 'none',
    prepare: reauthCodeAtRest,
  },
  {
    id: 'sign-in-reauth-reauth-mismatch',
    path: '/dev/screens/sign-in-reauth/reauthMismatch',
    auth: 'none',
    prepare: reauthSheetAtRest,
  },
  {
    id: 'sign-in-reauth-reauth-busy',
    path: '/dev/screens/sign-in-reauth/reauthBusy',
    auth: 'none',
    prepare: reauthSheetAtRest,
  },
  {
    id: 'system-adults-only-adults-only',
    path: '/dev/screens/system-adults-only/adultsOnly',
    auth: 'none',
  },
  {
    id: 'system-unavailable-in-state-state-unavailable-named',
    path: '/dev/screens/system-unavailable-in-state/stateUnavailableNamed',
    auth: 'none',
  },
  {
    id: 'system-unavailable-in-state-state-unavailable-generic',
    path: '/dev/screens/system-unavailable-in-state/stateUnavailableGeneric',
    auth: 'none',
  },
  // The agreements sheet, captured once it is where it rests.
  {
    id: 'system-agreements-agreements-terms',
    path: '/dev/screens/system-agreements/agreementsTerms',
    auth: 'none',
    prepare: agreementsSheetAtRest,
  },
  {
    id: 'system-agreements-agreements-privacy-only',
    path: '/dev/screens/system-agreements/agreementsPrivacyOnly',
    auth: 'none',
    prepare: agreementsSheetAtRest,
  },
  {
    id: 'system-agreements-agreements-saving',
    path: '/dev/screens/system-agreements/agreementsSaving',
    auth: 'none',
    prepare: agreementsSheetAtRest,
  },
  {
    id: 'system-agreements-agreements-error',
    path: '/dev/screens/system-agreements/agreementsError',
    auth: 'none',
    prepare: agreementsSheetAtRest,
  },
  // Home before anything fills it. The fixture route has no tab navigator, so no tab bar is drawn.
  { id: 'home-home-placeholder', path: '/dev/screens/home/homePlaceholder', auth: 'none' },
  // The settings screens, in the app's shell with Profile active. A sheet or a dialog is captured
  // once it is where it rests; the issues screen's limit lines and its tight layout are drawn as
  // the sign-up step's are.
  {
    id: 'settings-settings-default',
    path: '/dev/screens/settings/settingsDefault',
    auth: 'none',
  },
  {
    id: 'settings-settings-support',
    path: '/dev/screens/settings/settingsSupport',
    auth: 'none',
  },
  {
    id: 'settings-settings-logging-out',
    path: '/dev/screens/settings/settingsLoggingOut',
    auth: 'none',
  },
  {
    id: 'settings-settings-loading',
    path: '/dev/screens/settings/settingsLoading',
    auth: 'none',
  },
  {
    id: 'settings-settings-error',
    path: '/dev/screens/settings/settingsError',
    auth: 'none',
  },
  {
    id: 'settings-settings-offline',
    path: '/dev/screens/settings/settingsOffline',
    auth: 'none',
  },
  {
    id: 'settings-settings-stale',
    path: '/dev/screens/settings/settingsStale',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit',
    path: '/dev/screens/settings-profile/profileEdit',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-dirty',
    path: '/dev/screens/settings-profile/profileEditDirty',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-saving',
    path: '/dev/screens/settings-profile/profileEditSaving',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-saved',
    path: '/dev/screens/settings-profile/profileEditSaved',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-field-errors',
    path: '/dev/screens/settings-profile/profileEditFieldErrors',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-handle-locked',
    path: '/dev/screens/settings-profile/profileEditHandleLocked',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-avatar-pending',
    path: '/dev/screens/settings-profile/profileEditAvatarPending',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-ai-consent',
    path: '/dev/screens/settings-profile/profileEditAiConsent',
    auth: 'none',
    prepare: aiConsentSheetAtRest,
  },
  {
    id: 'settings-profile-profile-edit-loading',
    path: '/dev/screens/settings-profile/profileEditLoading',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-error',
    path: '/dev/screens/settings-profile/profileEditError',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-offline',
    path: '/dev/screens/settings-profile/profileEditOffline',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-stale',
    path: '/dev/screens/settings-profile/profileEditStale',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-loading',
    path: '/dev/screens/settings-issues/settingsIssuesLoading',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-error',
    path: '/dev/screens/settings-issues/settingsIssuesError',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-offline',
    path: '/dev/screens/settings-issues/settingsIssuesOffline',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-none',
    path: '/dev/screens/settings-issues/settingsIssuesNone',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-stale',
    path: '/dev/screens/settings-issues/settingsIssuesStale',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-two',
    path: '/dev/screens/settings-issues/settingsIssuesTwo',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-five',
    path: '/dev/screens/settings-issues/settingsIssuesFive',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-ten',
    path: '/dev/screens/settings-issues/settingsIssuesTen',
    auth: 'none',
    prepare: tapPastLimit('onboarding.issue-schools', '10 is the most'),
  },
  {
    id: 'settings-issues-settings-issues-star-limit',
    path: '/dev/screens/settings-issues/settingsIssuesStarLimit',
    auth: 'none',
    prepare: tapPastLimit('onboarding.issue-property-taxes-star', '3 stars is the most'),
  },
  {
    id: 'settings-issues-settings-issues-sending',
    path: '/dev/screens/settings-issues/settingsIssuesSending',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-submit-error',
    path: '/dev/screens/settings-issues/settingsIssuesSubmitError',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-tight',
    path: '/dev/screens/settings-issues/settingsIssuesTight?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'settings-issues-settings-issues-saved',
    path: '/dev/screens/settings-issues/settingsIssuesSaved',
    auth: 'none',
  },
  {
    id: 'settings-account-account-with-email',
    path: '/dev/screens/settings-account/accountWithEmail',
    auth: 'none',
  },
  {
    id: 'settings-account-account-no-email',
    path: '/dev/screens/settings-account/accountNoEmail',
    auth: 'none',
  },
  {
    id: 'settings-account-account-email-bounced',
    path: '/dev/screens/settings-account/accountEmailBounced',
    auth: 'none',
  },
  {
    id: 'settings-account-account-add-email-code',
    path: '/dev/screens/settings-account/accountAddEmailCode',
    auth: 'none',
    prepare: addEmailCodeAtRest,
  },
  {
    id: 'settings-account-account-add-email-in-use',
    path: '/dev/screens/settings-account/accountAddEmailInUse',
    auth: 'none',
    prepare: addEmailSheetAtRest,
  },
  {
    id: 'settings-account-account-loading',
    path: '/dev/screens/settings-account/accountLoading',
    auth: 'none',
  },
  {
    id: 'settings-account-account-error',
    path: '/dev/screens/settings-account/accountError',
    auth: 'none',
  },
  {
    id: 'settings-account-account-offline',
    path: '/dev/screens/settings-account/accountOffline',
    auth: 'none',
  },
  {
    id: 'settings-account-account-stale',
    path: '/dev/screens/settings-account/accountStale',
    auth: 'none',
  },
  {
    id: 'settings-appearance-appearance-system',
    path: '/dev/screens/settings-appearance/appearanceSystem',
    auth: 'none',
  },
  {
    id: 'settings-appearance-appearance-dark',
    path: '/dev/screens/settings-appearance/appearanceDark',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-m1',
    path: '/dev/screens/settings-privacy/privacyM1',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-saving',
    path: '/dev/screens/settings-privacy/privacySaving',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-save-failed',
    path: '/dev/screens/settings-privacy/privacySaveFailed',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-loading',
    path: '/dev/screens/settings-privacy/privacyLoading',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-error',
    path: '/dev/screens/settings-privacy/privacyError',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-offline',
    path: '/dev/screens/settings-privacy/privacyOffline',
    auth: 'none',
  },
  {
    id: 'settings-privacy-privacy-stale',
    path: '/dev/screens/settings-privacy/privacyStale',
    auth: 'none',
  },
  {
    id: 'settings-export-export-none',
    path: '/dev/screens/settings-export/exportNone',
    auth: 'none',
  },
  {
    id: 'settings-export-export-queued',
    path: '/dev/screens/settings-export/exportQueued',
    auth: 'none',
  },
  {
    id: 'settings-export-export-ready',
    path: '/dev/screens/settings-export/exportReady',
    auth: 'none',
  },
  {
    id: 'settings-export-export-expired',
    path: '/dev/screens/settings-export/exportExpired',
    auth: 'none',
  },
  {
    id: 'settings-export-export-failed',
    path: '/dev/screens/settings-export/exportFailed',
    auth: 'none',
  },
  {
    id: 'settings-export-export-wait',
    path: '/dev/screens/settings-export/exportWait',
    auth: 'none',
    prepare: exportWaitAtFixtureTime,
  },
  {
    id: 'settings-export-export-reauth',
    path: '/dev/screens/settings-export/exportReauth',
    auth: 'none',
    prepare: reauthSheetAtRest,
  },
  {
    id: 'settings-export-export-loading',
    path: '/dev/screens/settings-export/exportLoading',
    auth: 'none',
  },
  {
    id: 'settings-export-export-error',
    path: '/dev/screens/settings-export/exportError',
    auth: 'none',
  },
  {
    id: 'settings-export-export-offline',
    path: '/dev/screens/settings-export/exportOffline',
    auth: 'none',
  },
  {
    id: 'settings-export-export-stale',
    path: '/dev/screens/settings-export/exportStale',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-info',
    path: '/dev/screens/settings-delete-account/deleteInfo',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-confirm',
    path: '/dev/screens/settings-delete-account/deleteConfirm',
    auth: 'none',
    prepare: deleteDialogAtRest,
  },
  {
    id: 'settings-delete-account-delete-reauth',
    path: '/dev/screens/settings-delete-account/deleteReauth',
    auth: 'none',
    prepare: reauthSheetAtRest,
  },
  {
    id: 'settings-delete-account-delete-deleting',
    path: '/dev/screens/settings-delete-account/deleteDeleting',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-error',
    path: '/dev/screens/settings-delete-account/deleteError',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-suspended',
    path: '/dev/screens/settings-delete-account/deleteSuspended',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-deleted',
    path: '/dev/screens/settings-delete-account/deleteDeleted',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-loading',
    path: '/dev/screens/settings-delete-account/deleteLoading',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-load-error',
    path: '/dev/screens/settings-delete-account/deleteLoadError',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-offline',
    path: '/dev/screens/settings-delete-account/deleteOffline',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-stale',
    path: '/dev/screens/settings-delete-account/deleteStale',
    auth: 'none',
  },
  {
    id: 'settings-about-about-m1',
    path: '/dev/screens/settings-about/aboutM1',
    auth: 'none',
  },
  // An unknown pair renders the not-found content.
  { id: 'dev-screens-unknown-pair', path: '/dev/screens/none/none', auth: 'none' },
  // The design review's 130% text size.
  {
    id: 'not-found-not-found-default-x130',
    path: '/dev/screens/not-found/notFoundDefault?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'system-update-update-with-store-x130',
    path: '/dev/screens/system-update/updateWithStore?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'onboarding-issues-issues-five-x130',
    path: '/dev/screens/onboarding-issues/issuesFive?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'onboarding-handle-handle-taken-x130',
    path: '/dev/screens/onboarding-handle/handleTaken?textScale=1.3',
    auth: 'none',
    prepare: typeHandle('test_fixture'),
  },
  {
    id: 'onboarding-photo-photo-ready-x130',
    path: '/dev/screens/onboarding-photo/photoReady?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'welcome-welcome-default-x130',
    path: '/dev/screens/welcome/welcomeDefault?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-methods-email-only-x130',
    path: '/dev/screens/sign-in/signInMethodsEmailOnly?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'sign-in-sign-in-code-wrong-x130',
    path: '/dev/screens/sign-in/signInCodeWrong?textScale=1.3',
    auth: 'none',
    prepare: atFixtureTime,
  },
  {
    id: 'sign-in-sign-in-age-gate-x130',
    path: '/dev/screens/sign-in/signInAgeGate?textScale=1.3',
    auth: 'none',
    prepare: ageGateWordsWhole,
  },
  {
    id: 'settings-settings-default-x130',
    path: '/dev/screens/settings/settingsDefault?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'settings-profile-profile-edit-x130',
    path: '/dev/screens/settings-profile/profileEdit?textScale=1.3',
    auth: 'none',
  },
  {
    id: 'settings-delete-account-delete-info-x130',
    path: '/dev/screens/settings-delete-account/deleteInfo?textScale=1.3',
    auth: 'none',
  },
  { id: 'dev-spike-map', path: '/dev/spikes/map', auth: 'none', prepare: waitForMapSpike },
  { id: 'dev-spike-card', path: '/dev/spikes/card', auth: 'none', prepare: waitForCardSpike },
  // The spike's 1,000 rows are far more than the 60 screens one capture takes, so the design review
  // captures twelve of them, four of each kind; the scroll test covers the whole list.
  {
    id: 'dev-spike-list',
    path: '/dev/spikes/list?rows=12',
    auth: 'none',
    prepare: waitForListSpike,
  },
  // The art contact sheet: every drawing the app holds, for the art review.
  { id: 'dev-art', path: '/dev/art', auth: 'none' },
  { id: 'legal-privacy', path: '/privacy', auth: 'none' },
  { id: 'legal-terms', path: '/terms', auth: 'none' },
  { id: 'legal-content-policy', path: '/content-policy', auth: 'none' },
];
