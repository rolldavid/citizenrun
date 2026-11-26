import type { DataExportStatus, DataExportView } from '@citizenrun/shared';

import type { ReauthViewModel } from '@/features/auth';
import { noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsExportViewModel } from './settings-export.types';

type Ready = Extract<SettingsExportViewModel, { status: 'ready' }>;
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

const REQUESTED_AT = '2027-01-15T12:00:00.000Z';
const A_DAY_LATER = '2027-01-16T12:00:00.000Z';

const QUEUED: DataExportView = {
  id: '01890000-0000-7000-8000-0000000000e1',
  status: 'queued',
  requestedAt: REQUESTED_AT,
  readyAt: null,
  expiresAt: null,
};

function readyWith(status: DataExportStatus, data: Partial<Data> = {}, stale = false): Ready {
  return {
    status: 'ready',
    data: {
      status,
      requesting: false,
      downloading: false,
      errorCode: null,
      reauth: REAUTH_CLOSED,
      onRequest: noop,
      onDownload: noop,
      ...data,
    },
    refreshing: false,
    stale,
  };
}

const NONE: DataExportStatus = { export: null, nextRequestAt: null };

export const exportNone = readyWith(NONE) satisfies SettingsExportViewModel;

export const exportQueued = readyWith({
  export: QUEUED,
  nextRequestAt: A_DAY_LATER,
}) satisfies SettingsExportViewModel;

export const exportReady = readyWith({
  export: {
    ...QUEUED,
    status: 'ready',
    readyAt: '2027-01-15T12:04:00.000Z',
    expiresAt: '2027-01-16T12:04:00.000Z',
  },
  nextRequestAt: A_DAY_LATER,
}) satisfies SettingsExportViewModel;

export const exportExpired = readyWith({
  export: {
    ...QUEUED,
    status: 'expired',
    readyAt: '2027-01-15T12:04:00.000Z',
    expiresAt: '2027-01-16T12:04:00.000Z',
  },
  nextRequestAt: null,
}) satisfies SettingsExportViewModel;

export const exportFailed = readyWith({
  export: { ...QUEUED, status: 'failed' },
  nextRequestAt: null,
}) satisfies SettingsExportViewModel;

export const exportWait = readyWith({
  export: { ...QUEUED, status: 'failed' },
  nextRequestAt: A_DAY_LATER,
}) satisfies SettingsExportViewModel;

export const exportReauth = readyWith(NONE, {
  reauth: { ...REAUTH_CLOSED, open: true },
}) satisfies SettingsExportViewModel;

export const exportLoading = { status: 'loading' } satisfies SettingsExportViewModel;

export const exportError = {
  status: 'error',
  code: 'unavailable',
  onRetry: noop,
} satisfies SettingsExportViewModel;

export const exportOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies SettingsExportViewModel;

export const exportStale = readyWith(NONE, {}, true) satisfies SettingsExportViewModel;
