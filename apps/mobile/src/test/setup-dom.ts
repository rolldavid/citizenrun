// The setup file of dom:mobile (PM-test-seam). The mocks are written here, not in a module this file
// imports, so Vitest registers them before any test file loads.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { setPageLoad } from '@/ui/first-screen';

import { resetPlatformFakes } from './platform';

vi.mock('@/platform/session', () => import('./platform/session'));
vi.mock('@/platform/map', () => import('./platform/map'));
vi.mock('@/platform/upload', () => import('./platform/upload'));
vi.mock('@/platform/push', () => import('./platform/push'));
vi.mock('@/platform/share', () => import('./platform/share'));
vi.mock('@/platform/location', () => import('./platform/location'));
vi.mock('@/platform/haptics', () => import('./platform/haptics'));
vi.mock('@/platform/calendar', () => import('./platform/calendar'));
vi.mock('@/platform/auth', () => import('./platform/auth'));
vi.mock('@/platform/pdf', () => import('./platform/pdf'));
vi.mock('@/platform/video', () => import('./platform/video'));
vi.mock('@/platform/storage', () => import('./platform/storage'));
vi.mock('@/platform/links', () => import('./platform/links'));
vi.mock('@/platform/age-assurance', () => import('./platform/age-assurance'));
vi.mock('@/platform/query-client', () => import('./platform/query-client'));
vi.mock('@/platform/head', () => import('./platform/head'));
vi.mock('expo-router/head', () => ({ default: () => null }));
// expo-status-bar and expo-localization load the expo package, which jsdom cannot import. The status
// bar draws nothing on the web; the device is English.
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
// The original expo-router does not import in jsdom; src/ui uses no other member of it.
vi.mock('expo-router', async () => {
  const { TestLink } = await import('./router');
  return { Link: TestLink };
});

// jsdom has no `window.matchMedia`; Reanimated reads it at import for reduced motion.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  resetPlatformFakes();
  // A test mounts its screen as a route change brings it; a test of the first screen starts a page load.
  setPageLoad('behind');
});

// Vitest's globals are off, so the library's automatic cleanup does not run.
afterEach(() => {
  cleanup();
});
