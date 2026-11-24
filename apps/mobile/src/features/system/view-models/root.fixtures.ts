import type { RootViewModel } from './root.types';

export const rootStarting: RootViewModel = {
  boot: 'starting',
  themeChoice: 'system',
  fontsReady: false,
  system: null,
  shell: {
    mode: 'app',
    active: 'home',
    unread: { messages: 0, activity: 0 },
    place: null,
    signedIn: false,
  },
  onNavigate: () => undefined,
  onReselect: () => undefined,
};

export const rootSignedOut: RootViewModel = { ...rootStarting, boot: 'ready', fontsReady: true };

export const rootSignedIn: RootViewModel = {
  ...rootSignedOut,
  shell: { ...rootSignedOut.shell, signedIn: true },
};

export const rootUpdate: RootViewModel = {
  ...rootSignedOut,
  system: 'update',
  shell: { ...rootSignedOut.shell, mode: 'bare', active: null },
};
