import type {
  ClientInfo,
  Session,
  SessionCallbacks,
  SessionEndReason,
  SessionPresence,
} from '@/platform/session/types';

/** adopt records whether a token came, never the token. */
export type SessionFakeCall =
  | { op: 'configure' }
  | { op: 'adopt'; hasToken: boolean }
  | { op: 'endLocal'; reason: SessionEndReason };

const DEFAULT_CLIENT: ClientInfo = { platform: 'ios', appVersion: '1.0.0', header: 'ios/1.0.0' };
const DEFAULT_ORIGIN = 'http://api.test';

const calls: SessionFakeCall[] = [];
const state: {
  credential: Session['credential'];
  client: ClientInfo;
  apiOrigin: string;
  callbacks: SessionCallbacks | null;
  presence: SessionPresence;
} = {
  credential: 'bearer',
  client: DEFAULT_CLIENT,
  apiOrigin: DEFAULT_ORIGIN,
  callbacks: null,
  presence: 'absent',
};

// Accessor properties, so a test can vi.spyOn(session, 'client', 'get').
export const session: Session = {
  get credential() {
    return state.credential;
  },
  get client() {
    return state.client;
  },
  get apiOrigin() {
    return state.apiOrigin;
  },
  configure: (callbacks) => {
    calls.push({ op: 'configure' });
    state.callbacks = callbacks;
  },
  hydrate: () => Promise.resolve(state.presence),
  adopt: (info) => {
    calls.push({ op: 'adopt', hasToken: info.token !== null });
    return Promise.resolve();
  },
  endLocal: (reason) => {
    calls.push({ op: 'endLocal', reason });
    return Promise.resolve();
  },
};

export const sessionFake = {
  calls: calls as readonly SessionFakeCall[],
  setClient: (info: ClientInfo): void => {
    state.client = info;
  },
  setApiOrigin: (origin: string): void => {
    state.apiOrigin = origin;
  },
  setCredential: (credential: Session['credential']): void => {
    state.credential = credential;
  },
  /** The answer of hydrate(). */
  scriptPresence: (presence: SessionPresence): void => {
    state.presence = presence;
  },
  /** The callbacks of the last configure() call, so a test can play a 401 or a 426. */
  lastCallbacks: (): SessionCallbacks | null => state.callbacks,
  reset: (): void => {
    calls.length = 0;
    state.credential = 'bearer';
    state.client = DEFAULT_CLIENT;
    state.apiOrigin = DEFAULT_ORIGIN;
    state.callbacks = null;
    state.presence = 'absent';
  },
};
