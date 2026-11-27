import type { ColorToken } from '@/ui/tokens';

import type { MiniMapStillProps } from './mini-map-still';
import type { InteractionPreviewState } from './pressable';

/** An invented four-sided county, in the units of its box. */
const OUTLINE = {
  svg: 'M120 0 L1000 140 L880 1000 L0 760 Z',
  bbox: [0, 0, 20000, 20000],
} as const;

const EXACT = {
  outline: OUTLINE,
  placeName: 'Fixture Wren County',
  levelLabel: 'County',
  approximateText: null,
  openLabel: 'Show Fixture Wren County on the map',
  onPress: null,
} as const;

export const STATES = {
  exact: { ...EXACT, testID: 'gallery.mini-map-still-exact' },
  // A shape that is not the district's own says so under the level.
  approximate: {
    ...EXACT,
    approximateText: 'Check which district you live in.',
    testID: 'gallery.mini-map-still-approximate',
  },
  noOutline: { ...EXACT, outline: null, testID: 'gallery.mini-map-still-no-outline' },
  // The row opens the map: the form it takes once the map exists, shown for its geometry.
  pressable: {
    ...EXACT,
    onPress: () => undefined,
    testID: 'gallery.mini-map-still-pressable',
  },
  longPlace: {
    ...EXACT,
    placeName: 'Fixture Charlotte and Mecklenburg County Consolidated Area',
    openLabel: 'Show Fixture Charlotte and Mecklenburg County Consolidated Area on the map',
    testID: 'gallery.mini-map-still-long-place',
  },
  // Path data the shape does not read: the square stays empty.
  invalidOutline: {
    ...EXACT,
    outline: { ...OUTLINE, svg: 'M0 0 C10 10 Z' },
    testID: 'gallery.mini-map-still-invalid-outline',
  },
} as const satisfies Readonly<Record<string, MiniMapStillProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
