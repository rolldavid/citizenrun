import { noop } from '@/lib/view-models/__fixtures__/common';

import type { RootViewModel } from './root.types';

export const rootStarting = {
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
    showGetAppBar: false,
    suspended: null,
  },
  createDialogOpen: false,
  onNavigate: noop,
  onReselect: noop,
  onCloseCreateDialog: noop,
} satisfies RootViewModel;

export const rootSignedOut = {
  ...rootStarting,
  boot: 'ready',
  fontsReady: true,
} satisfies RootViewModel;

export const rootSignedIn = {
  ...rootSignedOut,
  shell: { ...rootSignedOut.shell, mode: 'app', active: 'home', signedIn: true },
} satisfies RootViewModel;

export const rootUpdate = {
  ...rootSignedOut,
  system: 'update',
  shell: { ...rootSignedOut.shell, mode: 'bare', active: null },
} satisfies RootViewModel;

export const rootAdultsOnly = {
  ...rootSignedOut,
  system: 'adultsOnly',
  shell: { ...rootSignedOut.shell, mode: 'bare', active: null },
} satisfies RootViewModel;

export const rootAgreements = {
  ...rootSignedIn,
  system: 'agreements',
} satisfies RootViewModel;
