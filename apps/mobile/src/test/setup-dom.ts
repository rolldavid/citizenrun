// The setup file of dom:mobile (PM-test-seam). The mocks are written here, not in a module this file
// imports, so Vitest registers them before any test file loads.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

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

beforeEach(() => {
  resetPlatformFakes();
});

// Vitest's globals are off, so the library's automatic cleanup does not run.
afterEach(() => {
  cleanup();
});
