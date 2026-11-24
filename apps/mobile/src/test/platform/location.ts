import type { PermissionState } from '@/platform/shared';
import type { DeviceLocation, PositionOutcome } from '@/platform/location/types';

/** Never coordinates. */
export type LocationFakeCall =
  { op: 'getPermission' } | { op: 'requestPermission' } | { op: 'getCurrentPosition' };

// A fixture point, obviously not a place.
const DEFAULT_POSITION: PositionOutcome = { kind: 'position', lat: 0, lng: 0, precision: 'exact' };

const calls: LocationFakeCall[] = [];
const state: { supported: boolean; permission: PermissionState; position: PositionOutcome } = {
  supported: true,
  permission: 'granted',
  position: DEFAULT_POSITION,
};

export const location: DeviceLocation = {
  get supported() {
    return state.supported;
  },
  getPermission: () => {
    calls.push({ op: 'getPermission' });
    return Promise.resolve(state.permission);
  },
  requestPermission: () => {
    calls.push({ op: 'requestPermission' });
    return Promise.resolve(state.permission);
  },
  getCurrentPosition: () => {
    calls.push({ op: 'getCurrentPosition' });
    return Promise.resolve(state.position);
  },
};

export const locationFake = {
  calls: calls as readonly LocationFakeCall[],
  /** The answer of getPermission and requestPermission. */
  scriptPermission: (permission: PermissionState): void => {
    state.permission = permission;
  },
  scriptPosition: (outcome: PositionOutcome): void => {
    state.position = outcome;
  },
  setSupported: (value: boolean): void => {
    state.supported = value;
  },
  reset: (): void => {
    calls.length = 0;
    state.supported = true;
    state.permission = 'granted';
    state.position = DEFAULT_POSITION;
  },
};
