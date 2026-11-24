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

export const SCREENS: ScreenEntry[] = [
  { id: 'dev-gallery', path: '/dev/gallery', auth: 'none', prepare: waitForGallery },
  {
    id: 'dev-gallery-text-130',
    path: '/dev/gallery?textScale=1.3',
    auth: 'none',
    prepare: waitForGallery,
  },
];
