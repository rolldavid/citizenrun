import type { ColorToken } from '@/ui/tokens';

import type { FlagProps } from './flag';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  fiveDays: { label: '5 days to file' },
  oneDay: { label: '1 day to file' },
  sevenDays: { label: '7 days to file' },
} as const satisfies Readonly<Record<string, FlagProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
