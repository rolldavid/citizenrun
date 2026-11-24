import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { RuleProps } from './rule';

export const STATES = {
  strong: { variant: 'strong' },
  soft: { variant: 'soft' },
  strongGutter: { variant: 'strong', inset: 'gutter' },
  softGutter: { variant: 'soft', inset: 'gutter' },
} as const satisfies Readonly<Record<string, RuleProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
