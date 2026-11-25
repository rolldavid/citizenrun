import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { SwitchProps } from './switch';

const change = (): void => undefined;

const FITS = 'Fits around a job';

export const STATES = {
  off: {
    value: false,
    onChange: change,
    label: FITS,
    testID: 'gallery.switch-off',
  },
  on: {
    value: true,
    onChange: change,
    label: FITS,
    testID: 'gallery.switch-on',
  },
  withHelper: {
    value: true,
    onChange: change,
    label: 'Personalize my feed',
    helper: 'Uses the issues you picked. They are stored privately.',
    testID: 'gallery.switch-with-helper',
  },
  disabled: {
    value: false,
    onChange: change,
    label: FITS,
    disabled: true,
    testID: 'gallery.switch-disabled',
  },
  // The change is on its way to the server: the label is on the loading pulse.
  busy: {
    value: true,
    onChange: change,
    label: 'Filing deadline reminders',
    busy: true,
    testID: 'gallery.switch-busy',
  },
  longLabel: {
    value: false,
    onChange: change,
    label:
      'Tell me when someone files to run for an office I follow in Wren County or the City of Alder',
    helper: 'At most 1 notification a day.',
    testID: 'gallery.switch-long-label',
  },
  hovered: {
    value: false,
    onChange: change,
    label: FITS,
    testID: 'gallery.switch-hovered',
  },
  pressed: {
    value: false,
    onChange: change,
    label: FITS,
    testID: 'gallery.switch-pressed',
  },
  focused: {
    value: false,
    onChange: change,
    label: FITS,
    testID: 'gallery.switch-focused',
  },
} as const satisfies Readonly<Record<string, SwitchProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  hovered: { hovered: true },
  pressed: { pressed: true },
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
