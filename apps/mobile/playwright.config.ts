import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

export default defineConfig({
  testDir: './e2e/web',
  projects: [
    { name: 'phone-light', use: { ...PHONE, colorScheme: 'light', browserName: 'chromium' } },
    { name: 'phone-dark', use: { ...PHONE, colorScheme: 'dark', browserName: 'chromium' } },
    { name: 'desktop-light', use: { ...DESKTOP, colorScheme: 'light', browserName: 'chromium' } },
    { name: 'desktop-dark', use: { ...DESKTOP, colorScheme: 'dark', browserName: 'chromium' } },
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
  },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}',
  ignoreSnapshots: !process.env.CI,
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-stack.ts',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://localhost:8080/readyz',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
});
