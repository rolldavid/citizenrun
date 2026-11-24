import { PlatformNotReadyError } from '@/platform/shared';
import type { PdfModule } from './types';

export const pdf: PdfModule = {
  rememberSupported: false,
  outputs: { preview: false, share: false, print: false, download: false },
  output: () => Promise.reject(new PlatformNotReadyError('pdf', 'output')),
  discard: () => {
    throw new PlatformNotReadyError('pdf', 'discard');
  },
  remember: () => Promise.reject(new PlatformNotReadyError('pdf', 'remember')),
  loadRemembered: () => Promise.reject(new PlatformNotReadyError('pdf', 'loadRemembered')),
  forgetRemembered: () => Promise.reject(new PlatformNotReadyError('pdf', 'forgetRemembered')),
};

export type * from './types';
