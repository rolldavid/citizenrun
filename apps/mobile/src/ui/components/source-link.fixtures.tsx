import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { SourceLinkProps } from './source-link';

const press = (): void => undefined;

// The page form of a source line: the host, then the date it was checked.
const PAGE_LINE = 'wrencounty.example. Checked Mon, Nov 9.';

export const STATES = {
  high: { confidence: 'high', text: PAGE_LINE, onPress: press, testID: 'gallery.source-link-high' },
  medium: {
    confidence: 'medium',
    text: PAGE_LINE,
    onPress: press,
    testID: 'gallery.source-link-medium',
  },
  low: { confidence: 'low', text: PAGE_LINE, onPress: press, testID: 'gallery.source-link-low' },
  noConfidence: {
    confidence: null,
    text: PAGE_LINE,
    onPress: press,
    testID: 'gallery.source-link-no-confidence',
  },
  // Under a feed card the words say the confidence, and no mark is drawn.
  feed: {
    confidence: null,
    text: 'Medium confidence · Sources',
    onPress: press,
    testID: 'gallery.source-link-feed',
  },
  // A host of 70 characters: the line wraps and keeps its date.
  longText: {
    confidence: 'medium',
    text: 'record.office-of-the-clerk-and-recorder.fixture-wren-county-zz.example. Checked Mon, Nov 9.',
    onPress: press,
    testID: 'gallery.source-link-long-text',
  },
  hover: {
    confidence: 'high',
    text: PAGE_LINE,
    onPress: press,
    testID: 'gallery.source-link-hover',
  },
  focus: {
    confidence: 'high',
    text: PAGE_LINE,
    onPress: press,
    testID: 'gallery.source-link-focus',
  },
} as const satisfies Readonly<Record<string, SourceLinkProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  hover: { hovered: true },
  focus: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
