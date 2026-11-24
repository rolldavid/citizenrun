import { PlatformNotReadyError } from '@/platform/shared';
import type { CalendarModule } from './types';

export const calendar: CalendarModule = {
  oneTapSupported: false,
  updatesSupported: false,
  getPermission: () => Promise.reject(new PlatformNotReadyError('calendar', 'getPermission')),
  requestPermission: () =>
    Promise.reject(new PlatformNotReadyError('calendar', 'requestPermission')),
  addEvents: () => Promise.reject(new PlatformNotReadyError('calendar', 'addEvents')),
  removeDeclarationEvents: () =>
    Promise.reject(new PlatformNotReadyError('calendar', 'removeDeclarationEvents')),
  downloadDeclarationFile: () => {
    throw new PlatformNotReadyError('calendar', 'downloadDeclarationFile');
  },
  subscribeLink: () => {
    throw new PlatformNotReadyError('calendar', 'subscribeLink');
  },
  openSubscribeLink: () =>
    Promise.reject(new PlatformNotReadyError('calendar', 'openSubscribeLink')),
};

export type * from './types';
