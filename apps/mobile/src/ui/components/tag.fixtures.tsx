import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { TagProps } from './tag';

export const STATES = {
  outline: { variant: 'outline', label: 'Not verified' },
  solid: { variant: 'solid', label: 'Filed' },
  // No label: the tag says "not known yet" itself.
  unknown: { variant: 'unknown' },
  party: { variant: 'outline', label: 'Independent' },
  long: { variant: 'outline', label: 'Committee registered' },
} as const satisfies Readonly<Record<string, TagProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
