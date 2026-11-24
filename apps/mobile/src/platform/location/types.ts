import type { PermissionState } from '../shared';
export type { PermissionState } from '../shared';

export type LocationUnavailableCode =
  | 'location.services_off' // the device's location services are off
  | 'location.timeout' // no position within 15 seconds
  | 'location.unavailable' // the device could not determine a position
  | 'location.insecure_context' // web: the page is not a secure context
  | 'location.unsupported'; // web: the browser has no geolocation

export type PositionOutcome =
  /** precision: 'exact' for a full-accuracy grant with an accuracy of 500 m or better; otherwise 'approx' (E-ME-13 body). */
  | { kind: 'position'; lat: number; lng: number; precision: 'exact' | 'approx' }
  | { kind: 'denied'; state: 'denied' | 'blocked' }
  | { kind: 'unavailable'; code: LocationUnavailableCode };

export interface DeviceLocation {
  /** True on phones; on the web, true when the browser has geolocation in a secure context. */
  readonly supported: boolean;
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  /** One position. Never prompts: when the permission is not 'granted' or 'limited' it answers 'denied'
   *  (an 'undetermined' state counts as 'denied'). Keeps no copy. */
  getCurrentPosition(): Promise<PositionOutcome>;
}
