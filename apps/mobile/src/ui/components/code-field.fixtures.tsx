import type { ColorToken } from '@/ui/tokens';

import type { CodeFieldProps } from './code-field';
import type { InteractionPreviewState } from './pressable';

const change = (): void => undefined;

export const STATES = {
  empty: {
    label: 'Code from your email',
    value: '',
    onChangeText: change,
    onComplete: change,
    status: 'idle',
    statusText: null,
    testID: 'gallery.code-field-empty',
  },
  partial: {
    label: 'Code from your email',
    value: '418',
    onChangeText: change,
    onComplete: change,
    status: 'idle',
    statusText: null,
    testID: 'gallery.code-field-partial',
  },
  complete: {
    label: 'Code from your email',
    value: '418207',
    onChangeText: change,
    onComplete: change,
    status: 'idle',
    statusText: null,
    testID: 'gallery.code-field-complete',
  },
  checking: {
    label: 'Code from your email',
    value: '418207',
    onChangeText: change,
    onComplete: change,
    status: 'checking',
    statusText: null,
    testID: 'gallery.code-field-checking',
  },
  wrong: {
    label: 'Code from your email',
    value: '418207',
    onChangeText: change,
    onComplete: change,
    status: 'wrong',
    statusText: 'That code is not right. Check the email and try again.',
    testID: 'gallery.code-field-wrong',
  },
  // Too many tries: the line says when to try again.
  locked: {
    label: 'Code from your email',
    value: '418207',
    onChangeText: change,
    onComplete: change,
    status: 'locked',
    statusText: 'Too many tries. Ask for a new code in 15 minutes.',
    testID: 'gallery.code-field-locked',
  },
  focused: {
    label: 'Code from your email',
    value: '418',
    onChangeText: change,
    onComplete: change,
    status: 'idle',
    statusText: null,
    testID: 'gallery.code-field-focused',
  },
} as const satisfies Readonly<Record<string, CodeFieldProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
