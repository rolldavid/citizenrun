import { fixtureMe, noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsViewModel } from './settings.types';

type Ready = Extract<SettingsViewModel, { status: 'ready' }>;
type SettingsData = Extract<SettingsViewModel, { status: 'ready' }>['data'];

function readyWith(overrides: Partial<SettingsData> = {}): Ready {
  return {
    status: 'ready',
    data: {
      me: fixtureMe(),
      appVersion: '1.0.0',
      legal: {
        terms: 'https://example.test/terms',
        privacyPolicy: 'https://example.test/privacy',
        contentPolicy: 'https://example.test/content-policy',
      },
      supportEmail: null,
      logoutStatus: 'idle',
      onLogout: noop,
      onOpenLegal: noop,
      themeChoice: 'system',
      onContactSupport: null,
      ...overrides,
    },
    refreshing: false,
    stale: false,
  };
}

export const settingsDefault = readyWith() satisfies SettingsViewModel;

export const settingsSupport = readyWith({
  supportEmail: 'support@example.test',
  onContactSupport: noop,
}) satisfies SettingsViewModel;

export const settingsLoggingOut = readyWith({
  logoutStatus: 'sending',
}) satisfies SettingsViewModel;

export const settingsLoading = { status: 'loading' } satisfies SettingsViewModel;

export const settingsError = {
  status: 'error',
  code: 'internal',
  onRetry: noop,
} satisfies SettingsViewModel;

export const settingsOffline = { status: 'offline', onRetry: noop } satisfies SettingsViewModel;

export const settingsStale = {
  ...readyWith(),
  stale: true,
} satisfies SettingsViewModel;
