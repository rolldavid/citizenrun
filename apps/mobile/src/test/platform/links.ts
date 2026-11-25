import type {
  Links,
  OpenOutcome,
  PageFontFace,
  PageKeyEvent,
  ReloadReason,
} from '@/platform/links/types';

/** openIssuedUrl records no URL (a presigned link is a secret); openMail records no address. */
export type LinksFakeCall =
  | { op: 'openExternal'; url: string }
  | { op: 'openIssuedUrl' }
  | { op: 'openMail' }
  | { op: 'openAppSettings' }
  | { op: 'openStoreListing' }
  | { op: 'reloadOnce'; reason: ReloadReason }
  | { op: 'subscribeKeyDown' }
  | { op: 'fontsReady'; faces: readonly PageFontFace[] };

type KeyListener = (event: PageKeyEvent) => void;

const calls: LinksFakeCall[] = [];
const keyListeners = new Set<KeyListener>();
const reloaded = new Set<ReloadReason>();
const scriptedReloads = new Map<ReloadReason, boolean[]>();
const state: {
  storeListingSupported: boolean;
  open: OpenOutcome;
  issuedUrl: OpenOutcome;
  fontsReady: boolean;
} = {
  storeListingSupported: false,
  open: 'opened',
  issuedUrl: 'opened',
  fontsReady: true,
};

export const links: Links = {
  openExternal: (url) => {
    calls.push({ op: 'openExternal', url });
    return Promise.resolve(state.open);
  },
  openIssuedUrl: () => {
    calls.push({ op: 'openIssuedUrl' });
    return Promise.resolve(state.issuedUrl);
  },
  openMail: () => {
    calls.push({ op: 'openMail' });
    return Promise.resolve(state.open);
  },
  openAppSettings: () => {
    calls.push({ op: 'openAppSettings' });
    return Promise.resolve(true);
  },
  get storeListingSupported() {
    return state.storeListingSupported;
  },
  openStoreListing: () => {
    calls.push({ op: 'openStoreListing' });
    return Promise.resolve(state.storeListingSupported);
  },
  reloadOnce: (reason) => {
    calls.push({ op: 'reloadOnce', reason });
    const answer = scriptedReloads.get(reason)?.shift() ?? !reloaded.has(reason);
    if (answer) {
      reloaded.add(reason);
    }
    return answer;
  },
  subscribeKeyDown: (listener) => {
    calls.push({ op: 'subscribeKeyDown' });
    keyListeners.add(listener);
    return () => {
      keyListeners.delete(listener);
    };
  },
  fontsReady: (faces) => {
    calls.push({ op: 'fontsReady', faces: [...faces] });
    return Promise.resolve(state.fontsReady);
  },
};

export const linksFake = {
  calls: calls as readonly LinksFakeCall[],
  /** Calls every listener subscribed through subscribeKeyDown. */
  emitKey: (event: PageKeyEvent): void => {
    for (const listener of [...keyListeners]) {
      listener(event);
    }
  },
  setStoreListingSupported: (value: boolean): void => {
    state.storeListingSupported = value;
  },
  /** The next answers of reloadOnce(reason), in order; the default rule applies once they are used. */
  scriptReloadOnce: (reason: ReloadReason, answers: readonly boolean[]): void => {
    scriptedReloads.set(reason, [...answers]);
  },
  /** The answer of openIssuedUrl. */
  scriptIssuedUrl: (outcome: OpenOutcome): void => {
    state.issuedUrl = outcome;
  },
  scriptFontsReady: (answer: boolean): void => {
    state.fontsReady = answer;
  },
  /** The answer of openExternal and openMail. */
  scriptOpen: (outcome: OpenOutcome): void => {
    state.open = outcome;
  },
  reset: (): void => {
    calls.length = 0;
    keyListeners.clear();
    reloaded.clear();
    scriptedReloads.clear();
    state.storeListingSupported = false;
    state.open = 'opened';
    state.issuedUrl = 'opened';
    state.fontsReady = true;
  },
};
