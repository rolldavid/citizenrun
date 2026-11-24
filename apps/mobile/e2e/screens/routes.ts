import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export type ScreenEntry = {
  id: string;
  path: string;
  auth: 'none' | 'user';
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

/** Opens one sheet or dialog of the gallery with the gallery's own button, and waits until it has faded in. */
function openGalleryOverlay(overlay: string): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByTestId(`gallery.open-${overlay}`).click();
    await page.getByTestId(`gallery.${overlay}`).waitFor();
    await expect(page.getByTestId(`gallery.${overlay}`)).toHaveCSS('opacity', '1');
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

export const SCREENS: ScreenEntry[] = [
  { id: 'dev-gallery', path: '/dev/gallery', auth: 'none', prepare: waitForGallery },
  {
    id: 'dev-gallery-text-130',
    path: '/dev/gallery?textScale=1.3',
    auth: 'none',
    prepare: waitForGallery,
  },
  // The whole gallery is taller at 360 by 740 than one capture takes, and grows with every component,
  // so the design review captures it one section at a time, in the gallery's order.
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
  { id: 'hello', path: '/', auth: 'none' },
  { id: 'hello-hello-loading', path: '/dev/screens/hello/helloLoading', auth: 'none' },
  { id: 'hello-hello-ready', path: '/dev/screens/hello/helloReady', auth: 'none' },
  { id: 'hello-hello-worker-stale', path: '/dev/screens/hello/helloWorkerStale', auth: 'none' },
  { id: 'hello-hello-refreshing', path: '/dev/screens/hello/helloRefreshing', auth: 'none' },
  { id: 'hello-hello-stale', path: '/dev/screens/hello/helloStale', auth: 'none' },
  { id: 'hello-hello-error', path: '/dev/screens/hello/helloError', auth: 'none' },
  { id: 'hello-hello-offline', path: '/dev/screens/hello/helloOffline', auth: 'none' },
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
  // An unknown pair renders the not-found content.
  { id: 'dev-screens-unknown-pair', path: '/dev/screens/none/none', auth: 'none' },
  // The design review's 130% text size.
  {
    id: 'hello-hello-ready-x130',
    path: '/dev/screens/hello/helloReady?textScale=1.3',
    auth: 'none',
  },
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
  { id: 'dev-spike-map', path: '/dev/spikes/map', auth: 'none', prepare: waitForMapSpike },
  { id: 'dev-spike-card', path: '/dev/spikes/card', auth: 'none', prepare: waitForCardSpike },
  { id: 'dev-spike-list', path: '/dev/spikes/list', auth: 'none', prepare: waitForListSpike },
];
