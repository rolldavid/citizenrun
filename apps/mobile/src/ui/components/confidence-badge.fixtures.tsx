import type { ColorToken } from '@/ui/tokens';

import type { ConfidenceBadgeProps } from './confidence-badge';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  high: { kind: 'confidence', level: 'high' },
  medium: { kind: 'confidence', level: 'medium' },
  low: { kind: 'confidence', level: 'low' },
  complete: { kind: 'record', level: 'complete' },
  partial: { kind: 'record', level: 'partial' },
  minimal: { kind: 'record', level: 'minimal' },
} as const satisfies Readonly<Record<string, ConfidenceBadgeProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
