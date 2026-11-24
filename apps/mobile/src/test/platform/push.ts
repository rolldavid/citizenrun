import type { PermissionState } from '@/platform/shared';
import type { Push, PushChannelId, PushData, PushRegistration } from '@/platform/push/types';

/** Never the token. */
export type PushFakeCall =
  | { op: 'initialize'; channelIds: readonly PushChannelId[] }
  | { op: 'requestPermission' }
  | { op: 'register' }
  | { op: 'getToken' };

type OpenListener = (data: PushData) => void;
type ForegroundDecision = (data: PushData) => boolean;

const FAKE_TOKEN = 'ExponentPushToken[fake]';
const FAKE_TIMEZONE = 'America/Chicago';
const DEFAULT_REGISTRATION: PushRegistration = {
  kind: 'registered',
  token: FAKE_TOKEN,
  timezone: FAKE_TIMEZONE,
};

// No foreground filter exists yet, so every push is shown.
const showEveryPush: ForegroundDecision = () => true;

const calls: PushFakeCall[] = [];
const openListeners = new Set<OpenListener>();
const state: {
  supported: boolean;
  permission: PermissionState;
  registration: PushRegistration;
  launchData: PushData | null;
} = {
  supported: true,
  permission: 'undetermined',
  registration: DEFAULT_REGISTRATION,
  launchData: null,
};

export const push: Push = {
  get supported() {
    return state.supported;
  },
  initialize: (channelNames) => {
    calls.push({ op: 'initialize', channelIds: Object.keys(channelNames) as PushChannelId[] }); // the record's own keys
    return Promise.resolve();
  },
  getPermission: () => Promise.resolve(state.permission),
  requestPermission: () => {
    calls.push({ op: 'requestPermission' });
    if (state.permission === 'undetermined') {
      state.permission = 'granted';
    }
    return Promise.resolve(state.permission);
  },
  register: () => {
    calls.push({ op: 'register' });
    return Promise.resolve(state.registration);
  },
  getToken: () => {
    calls.push({ op: 'getToken' });
    return Promise.resolve(state.permission === 'granted' ? FAKE_TOKEN : null);
  },
  deviceTimezone: () => FAKE_TIMEZONE,
  onOpen: (listener) => {
    openListeners.add(listener);
    return () => {
      openListeners.delete(listener);
    };
  },
  takeLaunchData: () => {
    const data = state.launchData;
    state.launchData = null;
    return Promise.resolve(data);
  },
};

export const pushFake = {
  calls: calls as readonly PushFakeCall[],
  /** The current permission; requestPermission turns only 'undetermined' into 'granted'. */
  scriptPermission: (permission: PermissionState): void => {
    state.permission = permission;
  },
  scriptRegistration: (registration: PushRegistration): void => {
    state.registration = registration;
  },
  /** The answer of the next takeLaunchData call. */
  scriptLaunchData: (data: PushData | null): void => {
    state.launchData = data;
  },
  setSupported: (value: boolean): void => {
    state.supported = value;
  },
  /** Calls every onOpen listener. */
  emitOpen: (data: PushData): void => {
    for (const listener of [...openListeners]) {
      listener(data);
    }
  },
  /** Whether a push arriving in the foreground is shown: always, until a foreground filter exists. */
  deliverForeground: showEveryPush,
  reset: (): void => {
    calls.length = 0;
    openListeners.clear();
    state.supported = true;
    state.permission = 'undetermined';
    state.registration = DEFAULT_REGISTRATION;
    state.launchData = null;
  },
};
