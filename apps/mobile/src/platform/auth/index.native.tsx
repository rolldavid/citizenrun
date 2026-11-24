import { PlatformNotReadyError } from '@/platform/shared';
import type { Auth } from './types';

export const auth: Auth = {
  prepare: () => Promise.reject(new PlatformNotReadyError('auth', 'prepare')),
  AppleSignInButton: () => null,
  GoogleSignInButton: () => null,
  clearProviderState: () => Promise.reject(new PlatformNotReadyError('auth', 'clearProviderState')),
};

export type * from './types';
