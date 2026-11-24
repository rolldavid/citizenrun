import type { Haptics } from './types';

export const haptics: Haptics = {
  supported: false,
  selection: () => undefined,
  impact: () => undefined,
  notify: () => undefined,
};

export type * from './types';
