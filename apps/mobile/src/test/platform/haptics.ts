import type { Haptics } from '@/platform/haptics/types';

export type HapticsFakeCall =
  | { method: 'selection' }
  | { method: 'impact'; weight: 'light' | 'medium' }
  | { method: 'notify'; kind: 'success' | 'warning' };

const calls: HapticsFakeCall[] = [];
const state = { supported: true };

export const haptics: Haptics = {
  get supported() {
    return state.supported;
  },
  selection: () => {
    calls.push({ method: 'selection' });
  },
  impact: (weight) => {
    calls.push({ method: 'impact', weight });
  },
  notify: (kind) => {
    calls.push({ method: 'notify', kind });
  },
};

export const hapticsFake = {
  calls: calls as readonly HapticsFakeCall[],
  setSupported: (value: boolean): void => {
    state.supported = value;
  },
  reset: (): void => {
    calls.length = 0;
    state.supported = true;
  },
};
