import type { ColorToken } from '@/ui/tokens';

import type { DeadlineRingProps } from './deadline-ring';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  twelve: { daysLeft: 12 },
  five: { daysLeft: 5 },
  zero: { daysLeft: 0 },
  // More than thirty days lights every tick.
  fortyTwo: { daysLeft: 42 },
  size120: { daysLeft: 12, size: 120 },
  // The lit ticks cut on once, the first time the item is seen.
  withMotion: { daysLeft: 12, itemKey: 'fixture-deadline-ring' },
} as const satisfies Readonly<Record<string, DeadlineRingProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
