import { PlatformNotReadyError } from '@/platform/shared';
import type { ShareModule } from './types';

export const share: ShareModule = {
  nativeSheetSupported: false,
  copySupported: false,
  prepare: () => Promise.reject(new PlatformNotReadyError('share', 'prepare')),
  shareLink: () => Promise.reject(new PlatformNotReadyError('share', 'shareLink')),
  copyLink: () => Promise.reject(new PlatformNotReadyError('share', 'copyLink')),
  release: () => {
    throw new PlatformNotReadyError('share', 'release');
  },
};

export type * from './types';
