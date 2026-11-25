import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { SelectProps } from './select';

const change = (): void => undefined;

/** A short list: few enough for a sheet as tall as its rows. */
const SORTS = [
  { value: 'deadline', label: 'Filing deadline, soonest first' },
  { value: 'pay', label: 'Pay, highest first' },
  { value: 'name', label: 'Office name, A to Z' },
  { value: 'level', label: 'Level, local first' },
] as const;

/** A list as long as the states and territories: 56 invented regions. */
const REGIONS = Array.from({ length: 56 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return { value: `region-${number}`, label: `Fixture region ${number}` };
});

export const STATES = {
  // Nothing is chosen until the person chooses.
  empty: {
    label: 'Sort offices by',
    value: null,
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    testID: 'gallery.select-empty',
  },
  chosen: {
    label: 'Sort offices by',
    value: 'pay',
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    testID: 'gallery.select-chosen',
  },
  helper: {
    label: 'Sort offices by',
    value: 'deadline',
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    helper: 'The order is kept for your next visit.',
    testID: 'gallery.select-helper',
  },
  error: {
    label: 'State or territory you live in',
    value: null,
    options: REGIONS,
    placeholder: 'Choose a state or territory',
    onChange: change,
    status: 'error',
    statusText: 'Choose a state or territory to continue.',
    testID: 'gallery.select-error',
  },
  disabled: {
    label: 'Sort offices by',
    value: 'name',
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    disabled: true,
    testID: 'gallery.select-disabled',
  },
  longList: {
    label: 'State or territory you live in',
    value: 'region-31',
    options: REGIONS,
    placeholder: 'Choose a state or territory',
    onChange: change,
    testID: 'gallery.select-long-list',
  },
  hovered: {
    label: 'Sort offices by',
    value: null,
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    testID: 'gallery.select-hovered',
  },
  pressed: {
    label: 'Sort offices by',
    value: null,
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    testID: 'gallery.select-pressed',
  },
  focused: {
    label: 'Sort offices by',
    value: null,
    options: SORTS,
    placeholder: 'Choose an order',
    onChange: change,
    testID: 'gallery.select-focused',
  },
} as const satisfies Readonly<Record<string, SelectProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  hovered: { hovered: true },
  pressed: { pressed: true },
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
