import type { PermissionState } from '@/platform/shared';
import type {
  CalendarAddOutcome,
  CalendarEventKind,
  CalendarModule,
} from '@/platform/calendar/types';

type SubscribeOutcome = Awaited<ReturnType<CalendarModule['openSubscribeLink']>>;
type CalendarCapabilities = { oneTapSupported: boolean; updatesSupported: boolean };

/** openSubscribeLink records the scheme only: the link carries the calendar token. */
export type CalendarFakeCall =
  | {
      op: 'addEvents';
      events: readonly { declarationId: string; kind: CalendarEventKind; date: string }[];
    }
  | { op: 'removeDeclarationEvents'; declarationId: string }
  | { op: 'downloadDeclarationFile'; declarationId: string }
  | { op: 'openSubscribeLink'; scheme: 'webcal' | 'https' };

const DEFAULT_CAPABILITIES: CalendarCapabilities = {
  oneTapSupported: true,
  updatesSupported: false,
};

const calls: CalendarFakeCall[] = [];
const state: {
  capabilities: CalendarCapabilities;
  permission: PermissionState;
  addOutcome: CalendarAddOutcome | null;
  subscribeOutcome: SubscribeOutcome;
} = {
  capabilities: { ...DEFAULT_CAPABILITIES },
  permission: 'granted',
  addOutcome: null,
  subscribeOutcome: 'opened',
};

export const calendar: CalendarModule = {
  get oneTapSupported() {
    return state.capabilities.oneTapSupported;
  },
  get updatesSupported() {
    return state.capabilities.updatesSupported;
  },
  getPermission: () => Promise.resolve(state.permission),
  requestPermission: () => Promise.resolve(state.permission),
  addEvents: (events) => {
    calls.push({
      op: 'addEvents',
      events: events.map(({ declarationId, kind, date }) => ({ declarationId, kind, date })),
    });
    return Promise.resolve(
      state.addOutcome ?? { kind: 'done', added: events.length, updated: 0, unchanged: 0 },
    );
  },
  removeDeclarationEvents: (declarationId) => {
    calls.push({ op: 'removeDeclarationEvents', declarationId });
    return Promise.resolve();
  },
  downloadDeclarationFile: (declarationId) => {
    calls.push({ op: 'downloadDeclarationFile', declarationId });
    return 'started';
  },
  subscribeLink: (feed) => feed.webcalUrl,
  openSubscribeLink: (link) => {
    calls.push({
      op: 'openSubscribeLink',
      scheme: link.startsWith('webcal:') ? 'webcal' : 'https',
    });
    return Promise.resolve(state.subscribeOutcome);
  },
};

export const calendarFake = {
  calls: calls as readonly CalendarFakeCall[],
  /** The answer of getPermission and requestPermission. */
  scriptPermission: (permission: PermissionState): void => {
    state.permission = permission;
  },
  /** The answer of addEvents; by default every event is added. */
  scriptAddOutcome: (outcome: CalendarAddOutcome): void => {
    state.addOutcome = outcome;
  },
  scriptSubscribeOutcome: (outcome: SubscribeOutcome): void => {
    state.subscribeOutcome = outcome;
  },
  setCapabilities: (flags: Partial<CalendarCapabilities>): void => {
    state.capabilities = { ...state.capabilities, ...flags };
  },
  reset: (): void => {
    calls.length = 0;
    state.capabilities = { ...DEFAULT_CAPABILITIES };
    state.permission = 'granted';
    state.addOutcome = null;
    state.subscribeOutcome = 'opened';
  },
};
