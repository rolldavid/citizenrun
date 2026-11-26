import type { SignInViewModel } from './sign-in.types';

/** The re-authentication sheet (R-122). */
export type ReauthViewModel = Pick<
  SignInViewModel,
  'providersBusy' | 'appleButton' | 'googleButton' | 'notice' | 'code'
> & {
  open: boolean;
  methods: readonly ('email' | 'apple' | 'google')[];
  emailStatus: 'idle' | 'sending';
  onSendCode: () => void;
  onClose: () => void;
};
