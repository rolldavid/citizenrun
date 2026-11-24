import type {
  PreparedShare,
  ShareModule,
  ShareOutcome,
  ShareRequest,
} from '@/platform/share/types';

export type ShareFakeCall = {
  op: 'prepare' | 'shareLink' | 'copyLink' | 'release';
  kind: ShareRequest['kind'];
  url: string;
};

type ShareCapabilities = { nativeSheetSupported: boolean; copySupported: boolean };
type ScriptedOp = 'shareLink' | 'copyLink';

const DEFAULT_CAPABILITIES: ShareCapabilities = {
  nativeSheetSupported: true,
  copySupported: false,
};
const DEFAULT_OUTCOMES: Readonly<Record<ScriptedOp, ShareOutcome>> = {
  shareLink: 'shared',
  copyLink: 'copied',
};

const calls: ShareFakeCall[] = [];
const state: {
  capabilities: ShareCapabilities;
  outcomes: Record<ScriptedOp, ShareOutcome>;
  prepared: number;
} = {
  capabilities: { ...DEFAULT_CAPABILITIES },
  outcomes: { ...DEFAULT_OUTCOMES },
  prepared: 0,
};

function record(op: ShareFakeCall['op'], request: ShareRequest): void {
  calls.push({ op, kind: request.kind, url: request.url });
}

export const share: ShareModule = {
  get nativeSheetSupported() {
    return state.capabilities.nativeSheetSupported;
  },
  get copySupported() {
    return state.capabilities.copySupported;
  },
  prepare: (request) => {
    record('prepare', request);
    state.prepared += 1;
    const prepared: PreparedShare = {
      id: `share-${String(state.prepared)}`,
      request,
      hasImage: false,
    };
    return Promise.resolve(prepared);
  },
  shareLink: (prepared) => {
    record('shareLink', prepared.request);
    return Promise.resolve(state.outcomes.shareLink);
  },
  copyLink: (prepared) => {
    record('copyLink', prepared.request);
    return Promise.resolve(state.outcomes.copyLink);
  },
  release: (prepared) => {
    record('release', prepared.request);
  },
};

export const shareFake = {
  calls: calls as readonly ShareFakeCall[],
  scriptOutcome: (op: ScriptedOp, outcome: ShareOutcome): void => {
    state.outcomes[op] = outcome;
  },
  setCapabilities: (flags: Partial<ShareCapabilities>): void => {
    state.capabilities = { ...state.capabilities, ...flags };
  },
  reset: (): void => {
    calls.length = 0;
    state.capabilities = { ...DEFAULT_CAPABILITIES };
    state.outcomes = { ...DEFAULT_OUTCOMES };
    state.prepared = 0;
  },
};
