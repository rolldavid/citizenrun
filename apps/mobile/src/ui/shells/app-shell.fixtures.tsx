import type { InteractionPreviewState } from '@/ui/components/pressable';
import type { ColorToken } from '@/ui/tokens';

import type { AppShellProps } from './app-shell';

// One set for C-AppShell and for the three layouts it chooses between. The specimen's content is
// the caller's: a state holds none.
export const STATES = {
  signedOutHome: {
    mode: 'app',
    active: 'home',
    onNavigate: () => undefined,
    onReselect: () => undefined,
    unread: { messages: 0, activity: 0 },
    place: null,
    topBar: null,
    banner: null,
    signedIn: false,
    children: null,
  },
  signedInUnread: {
    mode: 'app',
    active: 'home',
    onNavigate: () => undefined,
    onReselect: () => undefined,
    unread: { messages: 3, activity: 12 },
    place: { name: 'Wren County', districtCount: 14, officeCount: 38 },
    topBar: null,
    banner: null,
    signedIn: true,
    children: null,
  },
  // A route that belongs to no item of the navigation.
  noActive: {
    mode: 'app',
    active: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
    unread: { messages: 0, activity: 0 },
    place: null,
    topBar: null,
    banner: null,
    signedIn: false,
    children: null,
  },
  // No navigation chrome: welcome, sign-in, the system screens.
  bare: {
    mode: 'bare',
    active: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
    unread: { messages: 0, activity: 0 },
    place: null,
    topBar: null,
    banner: null,
    signedIn: false,
    children: null,
  },
} as const satisfies Readonly<Record<string, AppShellProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
