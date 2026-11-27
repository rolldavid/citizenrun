import type { ColorToken } from '@/ui/tokens';

import type { FollowButtonProps } from './follow-button';
import type { InteractionPreviewState } from './pressable';

/** What every state shares: one fixture person. */
const PERSON = {
  subject: 'Carol Wynn',
  itemKey: 'fixture-person',
  onToggle: () => undefined,
} as const;

export const STATES = {
  idle: { ...PERSON, following: false, testID: 'gallery.follow-button-idle' },
  following: { ...PERSON, following: true, testID: 'gallery.follow-button-following' },
  // The size a row carries.
  small: { ...PERSON, following: false, size: 'sm', testID: 'gallery.follow-button-small' },
  smallFollowing: {
    ...PERSON,
    following: true,
    size: 'sm',
    testID: 'gallery.follow-button-small-following',
  },
} as const satisfies Readonly<Record<string, FollowButtonProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
