import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWelcomeViewModel } from './use-welcome-view-model';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

describe('useWelcomeViewModel', () => {
  it('passes next on to sign-in', () => {
    const { result } = renderHook(() => useWelcomeViewModel({ next: '/settings/export' }));
    expect(result.current.startHref).toBe('/sign-in?next=%2Fsettings%2Fexport');
  });

  it('starts plain without next', () => {
    const { result } = renderHook(() => useWelcomeViewModel({ next: null }));
    expect(result.current).toEqual({
      startHref: '/sign-in',
      links: { terms: 'http://api.test/terms', privacyPolicy: 'http://api.test/privacy' },
    });
  });

  it('drops a next that points into sign-in', () => {
    const { result } = renderHook(() => useWelcomeViewModel({ next: '/sign-in' }));
    expect(result.current.startHref).toBe('/sign-in');
  });
});
