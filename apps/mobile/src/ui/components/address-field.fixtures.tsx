import type { ColorToken } from '@/ui/tokens';

import type { AddressFieldProps } from './address-field';
import type { InteractionPreviewState } from './pressable';

/** Seven invented addresses in Fixture Wren County, ZZ: the field draws the first five. */
const SEVEN = [
  {
    id: 'fixture-address-1',
    primary: '100 Fixture Street',
    secondary: 'Fixture Wren County, ZZ 00001',
  },
  {
    id: 'fixture-address-2',
    primary: '100 Fixture Avenue',
    secondary: 'Fixture Wren County, ZZ 00001',
  },
  { id: 'fixture-address-3', primary: '100 Fixture Court', secondary: 'Fixture Alder, ZZ 00002' },
  // A place with nothing to say under it.
  { id: 'fixture-address-4', primary: '100 Fixture Mill Road', secondary: null },
  {
    id: 'fixture-address-5',
    primary: '100 Fixture Old County Highway North, Building C',
    secondary: 'Fixture Charlotte and Mecklenburg County Consolidated Area, ZZ 00003',
  },
  { id: 'fixture-address-6', primary: '100 Fixture Terrace', secondary: 'Fixture Alder, ZZ 00002' },
  { id: 'fixture-address-7', primary: '100 Fixture Way', secondary: 'Fixture Alder, ZZ 00002' },
] as const;

const FIVE = SEVEN.slice(0, 5);

/** The provider's credit and the map data's, each with its link. */
const CREDITS = [
  { text: 'Suggestions by Fixture Provider', href: 'https://provider.example/credit' },
  { text: 'Map data from Fixture Atlas', href: 'https://atlas.example/copyright' },
] as const;

const FIELD = {
  label: 'Your address',
  value: '',
  onChangeText: () => undefined,
  suggestions: [],
  suggestionsStatus: 'idle',
  onSelect: () => undefined,
  onQuery: () => undefined,
  onSubmit: () => undefined,
} as const;

export const STATES = {
  empty: { ...FIELD, testID: 'gallery.address-field-empty' },
  // Under three characters nothing is asked and no list shows.
  typing: { ...FIELD, value: '10', testID: 'gallery.address-field-typing' },
  loading: {
    ...FIELD,
    value: '100 Fix',
    suggestionsStatus: 'loading',
    testID: 'gallery.address-field-loading',
  },
  ready: {
    ...FIELD,
    value: '100 Fix',
    suggestions: FIVE,
    suggestionsStatus: 'ready',
    credits: CREDITS,
    testID: 'gallery.address-field-ready',
  },
  // Seven suggestions: five rows are drawn.
  readyLong: {
    ...FIELD,
    value: '100 Fix',
    suggestions: SEVEN,
    suggestionsStatus: 'ready',
    credits: CREDITS,
    testID: 'gallery.address-field-ready-long',
  },
  // No suggestions to be had: the typed address can still be sent.
  unavailable: {
    ...FIELD,
    value: '100 Fixture Street',
    suggestionsStatus: 'unavailable',
    testID: 'gallery.address-field-unavailable',
  },
  usOnly: {
    ...FIELD,
    value: '100 Fixture Street',
    message: { kind: 'error', text: 'United States only.' },
    testID: 'gallery.address-field-us-only',
  },
  zipInfo: {
    ...FIELD,
    value: '00001',
    message: {
      kind: 'info',
      text: 'Based on your ZIP. Add your address for exact districts.',
    },
    testID: 'gallery.address-field-zip-info',
  },
  notCovered: {
    ...FIELD,
    value: '100 Fixture Street',
    message: { kind: 'error', text: "We don't cover Fixture Territory yet." },
    testID: 'gallery.address-field-not-covered',
  },
  disabled: {
    ...FIELD,
    value: '100 Fixture Street',
    disabled: true,
    testID: 'gallery.address-field-disabled',
  },
} as const satisfies Readonly<Record<string, AddressFieldProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
