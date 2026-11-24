import { size } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { SkeletonProps } from './skeleton';

export const STATES = {
  block: { shape: 'block' },
  circle: { shape: 'circle' },
  line: { shape: 'line' },
  lines3: { shape: 'line', lines: 3 },
  canvas: { shape: 'canvas' },
  card: { shape: 'card' },
  row: { shape: 'row' },
  // One cell of a two-column grid at its narrowest.
  cell: { shape: 'cell', width: size.canvasMinCell },
} as const satisfies Readonly<Record<string, SkeletonProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
