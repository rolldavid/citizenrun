import { fixtureMe, noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsPrivacyViewModel } from './settings-privacy.types';

type Ready = Extract<SettingsPrivacyViewModel, { status: 'ready' }>;

function readyWith(stale = false): Ready {
  return { status: 'ready', data: { me: fixtureMe() }, refreshing: false, stale };
}

export const privacyM1 = readyWith() satisfies SettingsPrivacyViewModel;

export const privacyLoading = { status: 'loading' } satisfies SettingsPrivacyViewModel;

export const privacyError = {
  status: 'error',
  code: 'unavailable',
  onRetry: noop,
} satisfies SettingsPrivacyViewModel;

export const privacyOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies SettingsPrivacyViewModel;

export const privacyStale = readyWith(true) satisfies SettingsPrivacyViewModel;
