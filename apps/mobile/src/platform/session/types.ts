export type ClientPlatform = 'ios' | 'android' | 'web';

/** What the app is, for X-OS-Client (L-client-version) and for the client error body (E-SAFE-02). */
export type ClientInfo = {
  platform: ClientPlatform;
  appVersion: string; // MAJOR.MINOR.PATCH, each part 0 to 9999
  header: string; // `${platform}/${appVersion}`; the bare 'web' when the web build carries no version
};

export type SessionCallbacks = {
  /** The mutator received 401. */
  onUnauthorized(): void;
  /** The mutator received 426. */
  onUpgradeRequired(): void;
};

export type SessionErrorCode = 'session.no_origin' | 'session.no_version' | 'session.store_failed';

export interface Session {
  // PM-session
  /** 'bearer' on phones; 'cookie' on the web. */
  readonly credential: 'bearer' | 'cookie';
  /** Read on first access; throws PlatformError('session', 'session.no_version') on a phone build without a version. */
  readonly client: ClientInfo;
  /** The origin the generated client calls: absolute on phones, '' on the web (same origin, D-032).
   *  Read on first access; throws PlatformError('session', 'session.no_origin') when none can be found. */
  readonly apiOrigin: string;
  /** Calls configureApiClient. A second call replaces the callbacks and changes nothing else. */
  configure(callbacks: SessionCallbacks): void;
}
