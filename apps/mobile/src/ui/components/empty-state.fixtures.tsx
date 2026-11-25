import type { ColorToken } from '@/ui/tokens';

import type { EmptyStateProps } from './empty-state';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  empty: {
    title: 'Nothing saved yet.',
    body: 'Bookmark an office and it stays here with its filing date.',
    action: {
      label: 'Explore offices',
      onPress: () => undefined,
      testID: 'gallery.empty-state-explore',
    },
  },
  emptyNoAction: {
    title: 'No posts yet.',
    body: 'Posts from Carol Wynn show up here.',
  },
  // The button is a link.
  emptyHref: {
    title: 'Nothing saved yet.',
    body: 'Bookmark an office and it stays here with its filing date.',
    action: { label: 'Explore offices', href: '/', testID: 'gallery.empty-state-href' },
  },
  // The button reads "Try again" whatever its label holds.
  error: {
    kind: 'error',
    title: "This isn't available right now. Try again in a few minutes.",
    action: { label: 'Reload', onPress: () => undefined, testID: 'gallery.empty-state-retry' },
  },
  // Inside a sheet, a side panel or the right column.
  artNone: {
    art: 'none',
    title: 'No one is running yet.',
    body: 'Filing for this office opens Mon, Jan 12.',
    action: {
      label: 'See the filing steps',
      variant: 'secondary',
      onPress: () => undefined,
      testID: 'gallery.empty-state-steps',
    },
  },
  // On a screen with no title of its own.
  headingOne: {
    headingLevel: 1,
    title: "This page isn't here.",
    body: 'It may have been moved or removed.',
    action: { label: 'Go to Home', href: '/', testID: 'gallery.empty-state-home' },
  },
  longText: {
    title: 'No offices match Wren County Board of Equalization and Assessment Appeals, District 4.',
    body: 'Try a shorter name, or look through every office in Wren County. Offices are added as each county publishes its filing calendar.',
    action: {
      label: 'See every office in Wren County',
      onPress: () => undefined,
      testID: 'gallery.empty-state-long',
    },
  },
} as const satisfies Readonly<Record<string, EmptyStateProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
