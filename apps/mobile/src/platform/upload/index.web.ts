import { PlatformNotReadyError } from '@/platform/shared';
import type { UploadModule } from './types';

export const upload: UploadModule = {
  pickAvatarPhoto: () => Promise.reject(new PlatformNotReadyError('upload', 'pickAvatarPhoto')),
  preparePhoto: () => Promise.reject(new PlatformNotReadyError('upload', 'preparePhoto')),
  release: () => {
    throw new PlatformNotReadyError('upload', 'release');
  },
};

export type * from './types';
