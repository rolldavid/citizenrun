import type { Me } from '@citizenrun/shared';

import { fixtureMe, noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsAccountViewModel } from './settings-account.types';

type Ready = Extract<SettingsAccountViewModel, { status: 'ready' }>;
type AccountData = Extract<SettingsAccountViewModel, { status: 'ready' }>['data'];
type AddEmail = AccountData['addEmail'];

const EMAIL_IDLE: AddEmail['email'] = {
  status: 'idle',
  errorCode: null,
  retryAfterSeconds: null,
  onSubmit: noop,
};

const CLOSED: AddEmail = { stage: 'closed', email: EMAIL_IDLE, code: null };

function noEmail(): Me {
  return fixtureMe({ email: null, signInMethods: ['apple'] });
}

function readyWith(me: Me, addEmail: AddEmail = CLOSED): Ready {
  return {
    status: 'ready',
    data: { me, addEmail, onOpenAddEmail: noop, onCloseAddEmail: noop },
    refreshing: false,
    stale: false,
  };
}

export const accountWithEmail = readyWith(fixtureMe()) satisfies SettingsAccountViewModel;

export const accountNoEmail = readyWith(noEmail()) satisfies SettingsAccountViewModel;

export const accountEmailBounced = readyWith(
  fixtureMe({ emailStatus: 'bounced' }),
) satisfies SettingsAccountViewModel;

export const accountAddEmailCode = readyWith(noEmail(), {
  stage: 'code',
  email: EMAIL_IDLE,
  code: {
    sentTo: 'fixture.new@example.test',
    status: 'idle',
    resendAvailableAt: '2027-01-15T12:01:00.000Z',
    resendStatus: 'idle',
    resendRetryAfterSeconds: null,
    onSubmit: noop,
    onResend: noop,
    onChangeEmail: noop,
  },
}) satisfies SettingsAccountViewModel;

export const accountAddEmailInUse = readyWith(noEmail(), {
  stage: 'email',
  email: { ...EMAIL_IDLE, errorCode: 'email_in_use' },
  code: null,
}) satisfies SettingsAccountViewModel;

export const accountLoading = { status: 'loading' } satisfies SettingsAccountViewModel;

export const accountError = {
  status: 'error',
  code: 'internal',
  onRetry: noop,
} satisfies SettingsAccountViewModel;

export const accountOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies SettingsAccountViewModel;

export const accountStale = {
  ...readyWith(fixtureMe()),
  stale: true,
} satisfies SettingsAccountViewModel;
