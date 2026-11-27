import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { TableProps } from './table';
import { Text } from './text';

const press = (): void => undefined;

const known = (text: string): { text: string; about: false } => ({ text, about: false });

// The two columns of words are as wide as their longest value at large text; the two columns of
// numbers share the room that is left.
const COLUMNS = [
  { id: 'year', header: 'Year', width: 144 },
  { id: 'winner', header: 'Winner', width: 152 },
  { id: 'margin', header: 'Margin', numeric: true },
  { id: 'votes', header: 'Votes cast', numeric: true },
] as const satisfies TableProps['columns'];

const GENERAL_2023 = {
  year: known('2023 general'),
  winner: known('Carol Wynn'),
  margin: known('61'),
  votes: known('2,100'),
};
const GENERAL_2019 = {
  year: known('2019 general'),
  winner: known('Carol Wynn'),
  margin: known('412'),
  votes: known('1,874'),
};
const GENERAL_2015 = {
  year: known('2015 general'),
  winner: known('Luis Marrero'),
  margin: known('38'),
  votes: known('1,650'),
};

const CAPTION = 'Past results for Fixture Wren County Treasurer';

export const STATES = {
  // The first row opens its election; the others open nothing.
  results: {
    columns: COLUMNS,
    rows: [
      { id: '2023-general', cells: GENERAL_2023, href: '/dev/gallery' },
      { id: '2019-general', cells: GENERAL_2019 },
      { id: '2015-general', cells: GENERAL_2015 },
    ],
    caption: CAPTION,
    testID: 'gallery.table-results',
  },
  // The column that holds the unknown tag is given the width the tag needs.
  unknown: {
    columns: [
      { id: 'year', header: 'Year', width: 144 },
      { id: 'winner', header: 'Winner', width: 152 },
      { id: 'margin', header: 'Margin', numeric: true, width: 160 },
      { id: 'votes', header: 'Votes cast', numeric: true },
    ],
    rows: [
      { id: '2023-general', cells: { ...GENERAL_2023, margin: { text: null, about: false } } },
      { id: '2019-general', cells: GENERAL_2019 },
    ],
    caption: CAPTION,
    testID: 'gallery.table-unknown',
  },
  about: {
    columns: COLUMNS,
    rows: [
      { id: '2023-general', cells: { ...GENERAL_2023, votes: { text: '2,100', about: true } } },
      { id: '2019-general', cells: GENERAL_2019 },
    ],
    caption: CAPTION,
    testID: 'gallery.table-about',
  },
  empty: {
    columns: COLUMNS,
    rows: [],
    caption: CAPTION,
    empty: <Text role="body">No past results loaded yet.</Text>,
    testID: 'gallery.table-empty',
  },
  // Wider than the narrowest phone: the table scrolls sideways and its first column stays.
  wide: {
    columns: [
      { id: 'year', header: 'Year', width: 144 },
      { id: 'winner', header: 'Winner', width: 152 },
      { id: 'margin', header: 'Margin', numeric: true, width: 96 },
      { id: 'votes', header: 'Votes cast', numeric: true, width: 112 },
      { id: 'registered', header: 'Registered', numeric: true, width: 112 },
      { id: 'turnout', header: 'Turnout', numeric: true, width: 96 },
    ],
    rows: [
      {
        id: '2023-general',
        cells: { ...GENERAL_2023, registered: known('14,800'), turnout: known('14%') },
      },
      {
        id: '2019-general',
        cells: { ...GENERAL_2019, registered: known('14,150'), turnout: known('13%') },
      },
      {
        id: '2015-general',
        cells: { ...GENERAL_2015, registered: known('13,900'), turnout: known('12%') },
      },
    ],
    caption: CAPTION,
    testID: 'gallery.table-wide',
  },
  pressable: {
    columns: COLUMNS,
    rows: [
      { id: '2023-general', cells: GENERAL_2023, onPress: press },
      { id: '2019-general', cells: GENERAL_2019, onPress: press },
      { id: '2015-general', cells: GENERAL_2015, onPress: press },
    ],
    caption: CAPTION,
    testID: 'gallery.table-pressable',
  },
} as const satisfies Readonly<Record<string, TableProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
