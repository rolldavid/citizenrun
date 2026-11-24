import type { PermissionState, Unsubscribe } from '../shared';
export type { PermissionState, Unsubscribe } from '../shared';

/** The Android notification channels. */
export type PushChannelId = 'social' | 'messages' | 'civic' | 'deadlines' | 'account'; // no 'admin' channel (D-801: admin_alert is delivered by email only)

/** A push's data as J-notify.push sends it: the deep-link path, the notification id or null, the type. */
export type PushData = { url: string; nid: string | null; t: string };

export type PushRegistration =
  | { kind: 'registered'; token: string; timezone: string } // send both to E-ME-15
  | { kind: 'denied'; state: PermissionState } // not granted; nothing to send
  | { kind: 'unsupported' } // web
  | { kind: 'failed'; code: PushErrorCode };

export type PushErrorCode = 'push.not_configured' | 'push.token_failed' | 'push.not_initialized';

export interface Push {
  // PM-push
  /** True on phones, false on the web. */
  readonly supported: boolean;
  /** Sets the foreground handler, creates the five Android channels every account has (`social`, `messages`,
   *  `civic`, `deadlines`, `account`) with these names (translated by the caller), and starts listening for taps.
   *  Called once after the first paint. Web: resolves at once. */
  initialize(channelNames: Readonly<Record<PushChannelId, string>>): Promise<void>;
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  /** The Expo push token and the device's time zone, when the permission is granted. Never prompts. */
  register(): Promise<PushRegistration>;
  /** The current token, or null when not granted or unsupported (the logout body). */
  getToken(): Promise<string | null>;
  /** The device's IANA time zone (D-173). Synchronous; also correct on the web. */
  deviceTimezone(): string;
  /** Taps on a notification while the app runs. The listener receives validated data. */
  onOpen(listener: (data: PushData) => void): Unsubscribe;
  /** The tap that launched the app from a cold start, once; null afterwards and when none. */
  takeLaunchData(): Promise<PushData | null>;
}
