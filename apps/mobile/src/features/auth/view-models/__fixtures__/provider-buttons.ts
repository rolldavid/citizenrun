import { noop } from '@/lib/view-models/__fixtures__/common';
import { auth } from '@/platform/auth';

import { createBoundButton } from '../bound-button';

export const FIXTURE_APPLE_BUTTON = createBoundButton(auth.AppleSignInButton, {
  nonceHash: 'fixture-nonce-hash',
  state: 'fixture-state',
  disabled: false,
  onStart: noop,
  onResult: noop,
}).Button;

export const FIXTURE_GOOGLE_BUTTON = createBoundButton(auth.GoogleSignInButton, {
  nonceHash: 'fixture-nonce-hash',
  disabled: false,
  onStart: noop,
  onResult: noop,
}).Button;
