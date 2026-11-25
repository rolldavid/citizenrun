import type { ColorToken } from '@/ui/tokens';

import type { HandleFieldProps } from './handle-field';
import type { InteractionPreviewState } from './pressable';

const change = (): void => undefined;

export const STATES = {
  idle: {
    label: 'Handle',
    value: '',
    onChangeText: change,
    check: 'idle',
    statusText: null,
    testID: 'gallery.handle-field-idle',
  },
  checking: {
    label: 'Handle',
    value: 'jomarsh',
    onChangeText: change,
    check: 'checking',
    statusText: null,
    testID: 'gallery.handle-field-checking',
  },
  free: {
    label: 'Handle',
    value: 'jomarsh',
    onChangeText: change,
    check: 'free',
    statusText: 'That one is free.',
    testID: 'gallery.handle-field-free',
  },
  taken: {
    label: 'Handle',
    value: 'dana',
    onChangeText: change,
    check: 'taken',
    statusText: 'Taken. Try another.',
    testID: 'gallery.handle-field-taken',
  },
  reserved: {
    label: 'Handle',
    value: 'clerk',
    onChangeText: change,
    check: 'reserved',
    statusText: 'That one is set aside. Try another.',
    testID: 'gallery.handle-field-reserved',
  },
  invalid: {
    label: 'Handle',
    value: 'jo',
    onChangeText: change,
    check: 'invalid',
    statusText: 'Use 3 to 20 letters, numbers, dots or underscores.',
    testID: 'gallery.handle-field-invalid',
  },
  focused: {
    label: 'Handle',
    value: 'jomarsh',
    onChangeText: change,
    check: 'idle',
    statusText: null,
    testID: 'gallery.handle-field-focused',
  },
} as const satisfies Readonly<Record<string, HandleFieldProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
