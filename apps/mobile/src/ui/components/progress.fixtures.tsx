import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { ProgressProps } from './progress';

export const STATES = {
  stepsFirst: { kind: 'steps', total: 5, done: 1, label: 'Step 1 of 5' },
  stepsFourth: { kind: 'steps', total: 5, done: 4, label: 'Step 4 of 5' },
  stepsDone: { kind: 'steps', total: 5, done: 5, label: 'Step 5 of 5' },
  amountZero: { kind: 'amount', value: 0, max: 150, label: '0 of about 150 signatures' },
  amountHalf: { kind: 'amount', value: 75, max: 150, label: '75 of about 150 signatures' },
  amountFull: { kind: 'amount', value: 150, max: 150, label: '150 of about 150 signatures' },
} as const satisfies Readonly<Record<string, ProgressProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
