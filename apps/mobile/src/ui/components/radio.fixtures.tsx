import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { RadioProps } from './radio';

const select = (): void => undefined;

const EVERYONE = 'Everyone can message me';

export const STATES = {
  unselected: {
    selected: false,
    label: EVERYONE,
    onSelect: select,
    testID: 'gallery.radio-unselected',
  },
  selected: {
    selected: true,
    label: EVERYONE,
    onSelect: select,
    testID: 'gallery.radio-selected',
  },
  withHelper: {
    selected: true,
    label: 'People I follow',
    helper: 'Anyone else can ask, and you choose whether to answer.',
    onSelect: select,
    testID: 'gallery.radio-with-helper',
  },
  longLabel: {
    selected: false,
    label:
      'Only people who hold or are running for an office on my ballot in Wren County or the City of Alder',
    onSelect: select,
    testID: 'gallery.radio-long-label',
  },
  hovered: {
    selected: false,
    label: EVERYONE,
    onSelect: select,
    testID: 'gallery.radio-hovered',
  },
  pressed: {
    selected: false,
    label: EVERYONE,
    onSelect: select,
    testID: 'gallery.radio-pressed',
  },
  focused: {
    selected: false,
    label: EVERYONE,
    onSelect: select,
    testID: 'gallery.radio-focused',
  },
} as const satisfies Readonly<Record<string, RadioProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  hovered: { hovered: true },
  pressed: { pressed: true },
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
