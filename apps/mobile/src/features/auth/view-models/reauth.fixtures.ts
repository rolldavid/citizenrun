import { noop } from '@/lib/view-models/__fixtures__/common';

import { FIXTURE_APPLE_BUTTON } from './__fixtures__/provider-buttons';
import type { ReauthViewModel } from './reauth.types';

const CODE = {
  sentTo: 'fixture@example.test',
  status: 'idle',
  resendAvailableAt: '2027-01-15T12:00:30.000Z',
  resendStatus: 'idle',
  resendRetryAfterSeconds: null,
  onSubmit: noop,
  onResend: noop,
  onChangeEmail: noop,
} satisfies ReauthViewModel['code'];

export const reauthMethods = {
  open: true,
  methods: ['email', 'apple'],
  emailStatus: 'idle',
  onSendCode: noop,
  onClose: noop,
  providersBusy: false,
  appleButton: FIXTURE_APPLE_BUTTON,
  googleButton: null,
  notice: null,
  code: null,
} satisfies ReauthViewModel;

export const reauthCode = {
  ...reauthMethods,
  code: CODE,
} satisfies ReauthViewModel;

export const reauthCodeWrong = {
  ...reauthMethods,
  code: { ...CODE, status: 'wrong' },
} satisfies ReauthViewModel;

export const reauthMismatch = {
  ...reauthMethods,
  notice: { code: 'reauth_mismatch', retryAfterSeconds: null },
} satisfies ReauthViewModel;

export const reauthBusy = {
  ...reauthMethods,
  providersBusy: true,
} satisfies ReauthViewModel;
