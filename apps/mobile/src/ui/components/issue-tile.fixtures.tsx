import type { ColorToken } from '@/ui/tokens';

import type { IssueTileProps } from './issue-tile';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  tile: { issueId: 'rent-housing' },
  // On the hover fill a tile carries its keyline.
  keyline: { issueId: 'policing-justice', keyline: true },
  // An id this build does not know.
  unknown: { issueId: 'not-an-issue' },
  // Where the issue's name is not printed beside the tile.
  labelled: { issueId: 'schools', label: 'Schools' },
} as const satisfies Readonly<Record<string, IssueTileProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {
  keyline: 'hoverBg',
};
