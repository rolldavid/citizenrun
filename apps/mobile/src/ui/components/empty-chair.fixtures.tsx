import { size } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import type { EmptyChairProps } from './empty-chair';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  default: {},
  small: { size: size.drawingEmpty / 2 },
} as const satisfies Readonly<Record<string, EmptyChairProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
