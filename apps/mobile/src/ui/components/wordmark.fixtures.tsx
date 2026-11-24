import { size } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { WordmarkProps } from './wordmark';

export const STATES = {
  wordmarkAppBar: { variant: 'wordmark', capHeight: size.wordmarkCap.appBar },
  wordmarkRail: { variant: 'wordmark', capHeight: size.wordmarkCap.rail },
  wordmarkMinimum: { variant: 'wordmark', capHeight: size.wordmarkCap.minimum },
  monogramRail: { variant: 'monogram', capHeight: size.monogramRail },
  inverse: { variant: 'wordmark', capHeight: size.wordmarkCap.rail, tone: 'inverse' },
} as const satisfies Readonly<Record<string, WordmarkProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {
  inverse: 'inverseBg',
};
