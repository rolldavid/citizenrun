import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

import { SCREENS } from './e2e/screens/routes.ts';
import type { ScreenViewport } from './e2e/screens/routes.ts';

type Viewport = { size: ScreenViewport; width: number; height: number; deviceScaleFactor: number };

// The four design-review viewports, each in light and dark.
const VIEWPORTS = [
  { size: '360x740', width: 360, height: 740, deviceScaleFactor: 2 },
  { size: '430x932', width: 430, height: 932, deviceScaleFactor: 2 },
  { size: '820x1180', width: 820, height: 1180, deviceScaleFactor: 2 },
  { size: '1440x900', width: 1440, height: 900, deviceScaleFactor: 1 },
] as const satisfies readonly Viewport[];
const SCHEMES = ['light', 'dark'] as const;

/**
 * The entries a viewport's projects leave out: each lists the viewports it is captured at, and this
 * is not one of them. A test is titled with its entry's id, which is kebab-case, and a title ends
 * the string a project's filter reads.
 */
function leftOut(size: ScreenViewport): RegExp[] {
  return SCREENS.filter(
    (entry) => entry.viewports !== undefined && !entry.viewports.some((each) => each === size),
  ).map((entry) => new RegExp(` ${entry.id}$`));
}

const baseUrl = process.env.SCREENS_BASE_URL;

const webServer: PlaywrightTestConfig['webServer'] = {
  command: 'pnpm exec tsx scripts/e2e-stack.ts',
  cwd: resolve(import.meta.dirname, '../..'),
  url: 'http://localhost:8080/readyz',
  reuseExistingServer: !process.env.CI,
  timeout: 120000,
};

export default defineConfig({
  testDir: './e2e/screens',
  projects: VIEWPORTS.flatMap((viewport) =>
    SCHEMES.map((scheme) => ({
      name: `${viewport.size}-${scheme}`,
      grepInvert: leftOut(viewport.size),
      use: {
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        colorScheme: scheme,
        browserName: 'chromium' as const,
      },
    })),
  ),
  use: {
    baseURL: baseUrl ?? 'http://localhost:8080',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
  },
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: 'list',
  ...(baseUrl === undefined ? { webServer } : {}),
});
