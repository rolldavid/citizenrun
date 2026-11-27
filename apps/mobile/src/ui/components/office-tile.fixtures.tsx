import type { ColorToken } from '@/ui/tokens';

import type { OfficeTileProps } from './office-tile';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  sm: { illustration: 'county-treasurer', size: 'sm' },
  md: { illustration: 'county-treasurer', size: 'md' },
  lg: { illustration: 'county-treasurer', size: 'lg' },
  // An office type whose own glyph is not drawn yet shows the glyph it stands in for.
  placeholderGlyph: { illustration: 'state-treasurer', size: 'md' },
  // A prompt card's tile: an interface icon in the glyph's place.
  icon: { illustration: null, icon: 'pin', size: 'md' },
  plain: { illustration: null, size: 'md' },
  labelled: {
    illustration: 'county-treasurer',
    size: 'md',
    label: 'County Treasurer',
    decorative: false,
  },
} as const satisfies Readonly<Record<string, OfficeTileProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
