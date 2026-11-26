import type { Me } from '@citizenrun/shared';

import type { ReauthViewModel } from '@/features/auth';
import { fixtureMe, noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsDeleteViewModel } from './settings-delete-account.types';

type Ready = Extract<SettingsDeleteViewModel, { status: 'ready' }>;
type Data = Ready['data'];

const REAUTH_CLOSED = {
  open: false,
  methods: ['email'],
  emailStatus: 'idle',
  onSendCode: noop,
  onClose: noop,
  providersBusy: false,
  appleButton: null,
  googleButton: null,
  notice: null,
  code: null,
} satisfies ReauthViewModel;

function readyWith(data: Partial<Data> = {}, stale = false): Ready {
  return {
    status: 'ready',
    data: {
      me: fixtureMe(),
      status: 'idle',
      errorCode: null,
      reauth: REAUTH_CLOSED,
      exportHref: '/settings/export',
      onAskDelete: noop,
      onConfirm: noop,
      onCancel: noop,
      ...data,
    },
    refreshing: false,
    stale,
  };
}

const SUSPENDED: Me = fixtureMe({
  status: 'suspended',
  suspension: { reason: 'spam', since: '2027-01-20T09:00:00.000Z' },
});

export const deleteInfo = readyWith() satisfies SettingsDeleteViewModel;

export const deleteConfirm = readyWith({ status: 'confirming' }) satisfies SettingsDeleteViewModel;

export const deleteReauth = readyWith({
  status: 'confirming',
  reauth: { ...REAUTH_CLOSED, open: true },
}) satisfies SettingsDeleteViewModel;

export const deleteDeleting = readyWith({ status: 'deleting' }) satisfies SettingsDeleteViewModel;

export const deleteError = readyWith({
  errorCode: 'unavailable',
}) satisfies SettingsDeleteViewModel;

export const deleteSuspended = readyWith({ me: SUSPENDED }) satisfies SettingsDeleteViewModel;

export const deleteDeleted = readyWith({ status: 'deleted' }) satisfies SettingsDeleteViewModel;

export const deleteLoading = { status: 'loading' } satisfies SettingsDeleteViewModel;

export const deleteLoadError = {
  status: 'error',
  code: 'unavailable',
  onRetry: noop,
} satisfies SettingsDeleteViewModel;

export const deleteOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies SettingsDeleteViewModel;

export const deleteStale = readyWith({}, true) satisfies SettingsDeleteViewModel;
