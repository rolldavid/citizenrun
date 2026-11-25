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

/** 'unknown' on the web: the cookie is invisible to JavaScript, so GET /v1/me decides. */
export type SessionPresence = 'present' | 'absent' | 'unknown';

/** Why the device forgets the session. */
export type SessionEndReason =
  'logout' | 'logout_all' | 'unauthorized' | 'account_deleted' | 'account_minor';

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

  // PM-session-tokens
  /** Phones: loads the token into memory from expo-secure-store. Web: resolves 'unknown'. Never rejects. */
  hydrate(): Promise<SessionPresence>;
  /** Phones: stores SessionInfo.token and uses it from the next request. A null token (E-AUTH-02 intent
   *  'add_email') changes nothing. Web: does nothing (the response set the cookie). Rejects with 'session.store_failed'. */
  adopt(info: { token: string | null; expiresAt: string }): Promise<void>;
  /** Forgets the session on this device and clears what CTL-11 lists, in order. Never rejects. */
  endLocal(reason: SessionEndReason): Promise<void>;
}
