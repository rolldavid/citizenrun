import type { ColorToken } from '@/ui/tokens';

import type { CountBadgeProps } from './count-badge';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  one: { count: 1 },
  nine: { count: 9 },
  ninetyNine: { count: 99 },
  overflow: { count: 100 },
  // Draws nothing.
  zero: { count: 0 },
  row: { count: 14, size: 'row' },
} as const satisfies Readonly<Record<string, CountBadgeProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
