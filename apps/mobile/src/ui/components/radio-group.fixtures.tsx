import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { RadioGroupProps } from './radio-group';

const change = (): void => undefined;

/** The theme choice. */
const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

/** Who may start a conversation, each choice with a line that says what it means. */
const MESSAGE_POLICIES = [
  {
    value: 'everyone',
    label: 'Everyone can message me',
    helper: 'Anyone with an account can start a conversation.',
  },
  {
    value: 'followed',
    label: 'People I follow',
    helper: 'Anyone else can ask, and you choose whether to answer.',
  },
  { value: 'nobody', label: 'Nobody', helper: 'The conversations you have stay open.' },
] as const;

/** The most options a group holds on a page. */
const SORTS = [
  { value: 'deadline', label: 'Filing deadline, soonest first' },
  { value: 'pay', label: 'Pay, highest first' },
  { value: 'pay-low', label: 'Pay, lowest first' },
  { value: 'name', label: 'Office name, A to Z' },
  { value: 'level', label: 'Level, local first' },
  { value: 'term', label: 'Term, shortest first' },
  { value: 'holders', label: 'Open seats first' },
  { value: 'contested', label: 'Uncontested first' },
  { value: 'election', label: 'Election date, soonest first' },
] as const;

export const STATES = {
  noneSelected: {
    label: 'Theme',
    value: null,
    options: THEMES,
    onChange: change,
    testID: 'gallery.radio-group-none-selected',
  },
  selected: {
    label: 'Theme',
    value: 'light',
    options: THEMES,
    onChange: change,
    testID: 'gallery.radio-group-selected',
  },
  withHelpers: {
    label: 'Who can message you',
    value: 'followed',
    options: MESSAGE_POLICIES,
    onChange: change,
    testID: 'gallery.radio-group-with-helpers',
  },
  // The label stays the group's name and takes no room: a heading above the group says it.
  labelHidden: {
    label: 'Theme',
    labelHidden: true,
    value: 'dark',
    options: THEMES,
    onChange: change,
    testID: 'gallery.radio-group-label-hidden',
  },
  nineOptions: {
    label: 'Sort offices by',
    value: 'deadline',
    options: SORTS,
    onChange: change,
    testID: 'gallery.radio-group-nine-options',
  },
} as const satisfies Readonly<Record<string, RadioGroupProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
