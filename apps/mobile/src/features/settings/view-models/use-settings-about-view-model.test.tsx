import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';

import { useSettingsAboutViewModel } from './use-settings-about-view-model';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSettingsAboutViewModel', () => {
  it('lists the three legal pages in order', () => {
    sessionFake.setApiOrigin('http://api.test');
    const { result } = renderHook(() => useSettingsAboutViewModel());
    expect(result.current.links).toEqual([
      { id: 'privacy', url: 'http://api.test/privacy' },
      { id: 'terms', url: 'http://api.test/terms' },
      { id: 'contentPolicy', url: 'http://api.test/content-policy' },
    ]);
  });

  it('shows no sources yet', () => {
    sessionFake.setClient({ platform: 'web', appVersion: '1.4.2', header: 'web/1.4.2' });
    const { result } = renderHook(() => useSettingsAboutViewModel());
    expect(result.current.sources).toEqual([]);
    expect(result.current.appVersion).toBe('1.4.2');
  });

  it('opens a link outside the app', () => {
    const { result } = renderHook(() => useSettingsAboutViewModel());
    act(() => {
      result.current.onOpen('http://api.test/terms');
    });
    expect(linksFake.calls).toEqual([{ op: 'openExternal', url: 'http://api.test/terms' }]);
  });
});
