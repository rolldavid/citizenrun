import type { InteractionPreviewState } from '@/ui/components/pressable';
import type { ColorToken } from '@/ui/tokens';

import type { AppBarProps } from './app-bar';

export const STATES = {
  // Before Messages exists: the wordmark alone.
  homeNoMessages: { variant: 'home', unreadMessages: 0, onOpenMessages: null },
  homeMessages: { variant: 'home', unreadMessages: 0, onOpenMessages: () => undefined },
  homeUnread: { variant: 'home', unreadMessages: 4, onOpenMessages: () => undefined },
  screen: { variant: 'screen', title: 'Settings', onBack: () => undefined },
  // The first screen of a stack: nothing to go back to.
  screenNoBack: { variant: 'screen', title: 'Settings', onBack: null },
  screenAction: {
    variant: 'screen',
    title: 'Profile',
    onBack: () => undefined,
    action: {
      icon: 'settings',
      label: 'Settings',
      onPress: () => undefined,
      testID: 'gallery.app-bar-action',
    },
  },
  // One line, cut with an ellipsis.
  screenLongTitle: {
    variant: 'screen',
    title: 'Wren County Board of Equalization and Assessment Appeals, District 4',
    onBack: () => undefined,
  },
} as const satisfies Readonly<Record<string, AppBarProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
