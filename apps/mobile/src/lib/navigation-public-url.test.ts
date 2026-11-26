import type * as Shared from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetSessionPresence } from '@/lib/session-state';
import { sessionFake } from '@/test/platform/session';
import { resetRouterMock } from '@/test/router-mock';

import { publicPageUrl, resetNavigationState } from './navigation';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const brandDouble = vi.hoisted(() => ({ host: null as string | null }));

vi.mock('@citizenrun/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    brandVariant: (name: Shared.BrandVariantName): Shared.BrandVariant => ({
      ...actual.brandVariant(name),
      host: brandDouble.host,
    }),
    siteOrigin: (name: Shared.BrandVariantName): string =>
      brandDouble.host === null ? actual.siteOrigin(name) : `https://${brandDouble.host}`,
  };
});

afterEach(() => {
  brandDouble.host = null;
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

describe('publicPageUrl', () => {
  it('legal links use the API origin while the variant has no host', () => {
    sessionFake.setApiOrigin('http://api.test');
    expect(publicPageUrl('/terms')).toBe('http://api.test/terms');
  });

  it('legal links use the site origin once the variant has a host', () => {
    brandDouble.host = 'example.test';
    expect(publicPageUrl('/privacy')).toBe('https://example.test/privacy');
  });
});
