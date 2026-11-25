import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { TextFieldProps } from './text-field';

const change = (): void => undefined;

/** A bio of 118 characters, and the same bio written out to the 160 a bio may hold. */
const BIO =
  'Renter in Alder since 2019. I sit through Wren County budget hearings and post what the board decided, in plain words.';
const BIO_AT_MAX =
  'Renter in Alder since 2019. I sit through the Wren County budget hearings and post what the board decided, in plain words. Running for county treasurer in 2027.';

/** A statement of twelve lines: more than the field shows before it scrolls. */
const LONG_STATEMENT = [
  'Why I am running for Wren County Clerk:',
  '1. The office closes at 4 pm, before most people are off work.',
  '2. The filing fee is posted nowhere.',
  '3. Forms are paper only.',
  '4. Results take 9 days to post.',
  '5. The phone line goes to a full mailbox.',
  '6. Meeting notes are not kept online.',
  '7. Records requests take 6 weeks.',
  '8. Nobody has run against the clerk since 2015.',
  '9. A new clerk can fix each of these in a year.',
  '10. I have run a front desk for 11 years.',
  'I would like your vote.',
].join('\n');

export const STATES = {
  empty: {
    label: 'Display name',
    value: '',
    onChangeText: change,
    testID: 'gallery.text-field-empty',
  },
  placeholder: {
    label: 'Street address',
    value: '',
    onChangeText: change,
    placeholder: '418 Alder St',
    testID: 'gallery.text-field-placeholder',
  },
  filled: {
    label: 'Display name',
    value: 'Dana Okafor',
    onChangeText: change,
    testID: 'gallery.text-field-filled',
  },
  helper: {
    label: 'Display name',
    value: 'Dana Okafor',
    onChangeText: change,
    helper: 'The name people see on your posts.',
    testID: 'gallery.text-field-helper',
  },
  error: {
    label: 'Display name',
    value: 'D',
    onChangeText: change,
    helper: 'The name people see on your posts.',
    status: 'error',
    statusText: 'Use 2 characters or more.',
    testID: 'gallery.text-field-error',
  },
  valid: {
    label: 'Street address',
    value: '418 Alder St',
    onChangeText: change,
    status: 'valid',
    statusText: 'Found in Wren County.',
    testID: 'gallery.text-field-valid',
  },
  // A field that cannot be changed says why in its helper.
  disabled: {
    label: 'Handle',
    value: 'dana.okafor',
    onChangeText: change,
    helper: 'You can change your handle again in 12 days, on Mon, Dec 7.',
    disabled: true,
    testID: 'gallery.text-field-disabled',
  },
  email: {
    label: 'Email',
    value: 'dana@example.test',
    onChangeText: change,
    kind: 'email',
    submitLabel: 'next',
    onSubmit: change,
    testID: 'gallery.text-field-email',
  },
  leadingIcon: {
    label: 'Search',
    labelHidden: true,
    value: '',
    onChangeText: change,
    placeholder: 'Offices, people, places',
    leadingIcon: 'search',
    testID: 'gallery.text-field-leading-icon',
  },
  clearable: {
    label: 'Search',
    labelHidden: true,
    value: 'county clerk',
    onChangeText: change,
    leadingIcon: 'search',
    onClear: change,
    testID: 'gallery.text-field-clearable',
  },
  count: {
    label: 'Bio',
    value: BIO,
    onChangeText: change,
    kind: 'multiline',
    maxLength: 160,
    showCount: true,
    testID: 'gallery.text-field-count',
  },
  countAtMax: {
    label: 'Bio',
    value: BIO_AT_MAX,
    onChangeText: change,
    kind: 'multiline',
    maxLength: 160,
    showCount: true,
    testID: 'gallery.text-field-count-at-max',
  },
  multiline: {
    label: 'Why are you running?',
    value: '',
    onChangeText: change,
    kind: 'multiline',
    placeholder: 'Say it the way you would to a neighbor.',
    testID: 'gallery.text-field-multiline',
  },
  // More lines than the field shows: it stops growing and scrolls inside.
  multilineLong: {
    label: 'Why are you running?',
    value: LONG_STATEMENT,
    onChangeText: change,
    kind: 'multiline',
    testID: 'gallery.text-field-multiline-long',
  },
  // A label that wraps at 130% text on a phone.
  longLabel: {
    label: 'The name of your campaign committee, as it is written on the form you filed',
    value: '',
    onChangeText: change,
    helper: 'Leave this empty if you have not filed yet.',
    testID: 'gallery.text-field-long-label',
  },
  focused: {
    label: 'Display name',
    value: 'Dana Okafor',
    onChangeText: change,
    testID: 'gallery.text-field-focused',
  },
} as const satisfies Readonly<Record<string, TextFieldProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
