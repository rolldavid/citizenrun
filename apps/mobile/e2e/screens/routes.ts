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

export const SCREENS: ScreenEntry[] = [
  { id: 'dev-gallery', path: '/dev/gallery', auth: 'none', prepare: waitForGallery },
  {
    id: 'dev-gallery-text-130',
    path: '/dev/gallery?textScale=1.3',
    auth: 'none',
    prepare: waitForGallery,
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
];
