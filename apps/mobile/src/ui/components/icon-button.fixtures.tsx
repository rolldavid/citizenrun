import type { ColorToken } from '@/ui/tokens';

import type { IconButtonProps } from './icon-button';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  plain: {
    icon: 'bookmark',
    label: 'Bookmark',
    testID: 'gallery.icon-button-plain',
    onPress: () => undefined,
  },
  plainHover: {
    icon: 'bookmark',
    label: 'Bookmark',
    testID: 'gallery.icon-button-plain-hover',
    onPress: () => undefined,
  },
  plainPressed: {
    icon: 'bookmark',
    label: 'Bookmark',
    testID: 'gallery.icon-button-plain-pressed',
    onPress: () => undefined,
  },
  plainFocus: {
    icon: 'bookmark',
    label: 'Bookmark',
    testID: 'gallery.icon-button-plain-focus',
    onPress: () => undefined,
  },
  plainDisabled: {
    icon: 'bookmark',
    label: 'Bookmark',
    testID: 'gallery.icon-button-plain-disabled',
    disabled: true,
    onPress: () => undefined,
  },
  framed: {
    icon: 'filter',
    variant: 'framed',
    label: 'Filter',
    testID: 'gallery.icon-button-framed',
    onPress: () => undefined,
  },
  framedHover: {
    icon: 'filter',
    variant: 'framed',
    label: 'Filter',
    testID: 'gallery.icon-button-framed-hover',
    onPress: () => undefined,
  },
  framedPressed: {
    icon: 'filter',
    variant: 'framed',
    label: 'Filter',
    testID: 'gallery.icon-button-framed-pressed',
    onPress: () => undefined,
  },
  framedFocus: {
    icon: 'filter',
    variant: 'framed',
    label: 'Filter',
    testID: 'gallery.icon-button-framed-focus',
    onPress: () => undefined,
  },
  framedDisabled: {
    icon: 'filter',
    variant: 'framed',
    label: 'Filter',
    testID: 'gallery.icon-button-framed-disabled',
    disabled: true,
    onPress: () => undefined,
  },
  primary: {
    icon: 'send',
    variant: 'primary',
    label: 'Send',
    testID: 'gallery.icon-button-primary',
    onPress: () => undefined,
  },
  primaryHover: {
    icon: 'send',
    variant: 'primary',
    label: 'Send',
    testID: 'gallery.icon-button-primary-hover',
    onPress: () => undefined,
  },
  primaryPressed: {
    icon: 'send',
    variant: 'primary',
    label: 'Send',
    testID: 'gallery.icon-button-primary-pressed',
    onPress: () => undefined,
  },
  primaryFocus: {
    icon: 'send',
    variant: 'primary',
    label: 'Send',
    testID: 'gallery.icon-button-primary-focus',
    onPress: () => undefined,
  },
  primaryDisabled: {
    icon: 'send',
    variant: 'primary',
    label: 'Send',
    testID: 'gallery.icon-button-primary-disabled',
    disabled: true,
    onPress: () => undefined,
  },
  // A toggle that is on: the filled form of the same icon, in the same color.
  selected: {
    icon: 'bookmark',
    selectedIcon: 'bookmarkFilled',
    selected: true,
    label: 'Bookmark',
    testID: 'gallery.icon-button-selected',
    onPress: () => undefined,
  },
  small: {
    icon: 'close',
    size: 'sm',
    label: 'Close',
    testID: 'gallery.icon-button-small',
    onPress: () => undefined,
  },
  withBadge: {
    icon: 'messages',
    badge: 3,
    label: 'Messages, 3 unread',
    testID: 'gallery.icon-button-with-badge',
    onPress: () => undefined,
  },
  badgeOverflow: {
    icon: 'messages',
    badge: 120,
    label: 'Messages, 120 unread',
    testID: 'gallery.icon-button-badge-overflow',
    onPress: () => undefined,
  },
} as const satisfies Readonly<Record<string, IconButtonProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  plainHover: { hovered: true },
  plainPressed: { pressed: true },
  plainFocus: { focused: true },
  framedHover: { hovered: true },
  framedPressed: { pressed: true },
  framedFocus: { focused: true },
  primaryHover: { hovered: true },
  primaryPressed: { pressed: true },
  primaryFocus: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
