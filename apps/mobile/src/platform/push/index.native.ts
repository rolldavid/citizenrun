import { PlatformNotReadyError } from '@/platform/shared';
import type { Push } from './types';

export const push: Push = {
  supported: false,
  initialize: () => Promise.reject(new PlatformNotReadyError('push', 'initialize')),
  getPermission: () => Promise.reject(new PlatformNotReadyError('push', 'getPermission')),
  requestPermission: () => Promise.reject(new PlatformNotReadyError('push', 'requestPermission')),
  register: () => Promise.reject(new PlatformNotReadyError('push', 'register')),
  getToken: () => Promise.reject(new PlatformNotReadyError('push', 'getToken')),
  deviceTimezone: () => {
    throw new PlatformNotReadyError('push', 'deviceTimezone');
  },
  onOpen: () => {
    throw new PlatformNotReadyError('push', 'onOpen');
  },
  takeLaunchData: () => Promise.reject(new PlatformNotReadyError('push', 'takeLaunchData')),
};

export type * from './types';
