import { PlatformNotReadyError } from '@/platform/shared';
import type { VideoModule } from './types';

export const video: VideoModule = {
  visibleThreshold: 60,
  controller: {
    preload: () => {
      throw new PlatformNotReadyError('video', 'controller.preload');
    },
    cancelPreload: () => {
      throw new PlatformNotReadyError('video', 'controller.cancelPreload');
    },
    getActiveId: () => {
      throw new PlatformNotReadyError('video', 'controller.getActiveId');
    },
  },
  Surface: () => null,
  useMuted: () => {
    throw new PlatformNotReadyError('video', 'useMuted');
  },
};

export type * from './types';
