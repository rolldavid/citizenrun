import type { InteractionPreviewState } from '@/ui/components/pressable';
import type { ColorToken } from '@/ui/tokens';

import type { RailProps } from './rail';

export const STATES = {
  iconsHome: {
    variant: 'icons',
    active: 'home',
    unread: { messages: 0, activity: 0 },
    place: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  iconsUnread: {
    variant: 'icons',
    active: 'home',
    unread: { messages: 3, activity: 12 },
    place: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  labeledHome: {
    variant: 'labeled',
    active: 'home',
    unread: { messages: 0, activity: 0 },
    place: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  labeledUnread: {
    variant: 'labeled',
    active: 'home',
    unread: { messages: 3, activity: 12 },
    place: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  labeledWithPlace: {
    variant: 'labeled',
    active: 'home',
    unread: { messages: 0, activity: 0 },
    place: { name: 'Wren County', districtCount: 14, officeCount: 38 },
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  // A route that belongs to no item of the rail.
  labeledNoActive: {
    variant: 'labeled',
    active: null,
    unread: { messages: 0, activity: 0 },
    place: null,
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  // One of each: the counts in the singular.
  labeledPlaceSingular: {
    variant: 'labeled',
    active: 'home',
    unread: { messages: 0, activity: 0 },
    place: { name: 'Fixture Alder', districtCount: 1, officeCount: 1 },
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
  // A place too long for one line of the foot.
  labeledLongPlace: {
    variant: 'labeled',
    active: 'home',
    unread: { messages: 0, activity: 0 },
    place: {
      name: 'Fixture Charlotte and Mecklenburg County Consolidated Area',
      districtCount: 14,
      officeCount: 38,
    },
    onNavigate: () => undefined,
    onReselect: () => undefined,
  },
} as const satisfies Readonly<Record<string, RailProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
