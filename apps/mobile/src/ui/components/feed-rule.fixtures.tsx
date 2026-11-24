import type { ColorToken } from '@/ui/tokens';

import type { FeedRuleProps } from './feed-rule';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  default: {},
} as const satisfies Readonly<Record<string, FeedRuleProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
