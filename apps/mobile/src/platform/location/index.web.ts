import { PlatformNotReadyError } from '@/platform/shared';
import type { DeviceLocation } from './types';

export const location: DeviceLocation = {
  supported: false,
  getPermission: () => Promise.reject(new PlatformNotReadyError('location', 'getPermission')),
  requestPermission: () =>
    Promise.reject(new PlatformNotReadyError('location', 'requestPermission')),
  getCurrentPosition: () =>
    Promise.reject(new PlatformNotReadyError('location', 'getCurrentPosition')),
};

export type * from './types';
