import type { InteractionPreviewState } from '@/ui/components/pressable';
import type { ColorToken } from '@/ui/tokens';

import type { TabBarProps } from './tab-bar';

export const STATES = {
  homeActive: {
    active: 'home',
    unreadActivity: 0,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  exploreActive: {
    active: 'explore',
    unreadActivity: 0,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  activityActive: {
    active: 'activity',
    unreadActivity: 0,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  profileActive: {
    active: 'profile',
    unreadActivity: 0,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  activityUnread: {
    active: 'home',
    unreadActivity: 3,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  // Above the largest count a badge writes out.
  activityUnreadOverflow: {
    active: 'home',
    unreadActivity: 120,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
} as const satisfies Readonly<Record<string, TabBarProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
