import type { ColorToken } from '@/ui/tokens';

import { Button } from './button';
import type { InteractionPreviewState } from './pressable';
import type { SourcesSheetProps } from './sources-sheet';

const close = (): void => undefined;

const BUDGET = 'https://wrencounty.example/budget';
const FILING = 'https://wrencounty.example/elections/filing';
const RESULTS = 'https://wrencounty.example/elections/results';
const DOMAIN = 'wrencounty.example';

// The page form of a source line: the host, then the date it was checked.
const PAGE_LINE = 'wrencounty.example. Checked Mon, Nov 9.';

export const STATES = {
  // A card's sheet: the pay and filing entries print the lines the canvas prints.
  card: {
    open: true,
    onClose: close,
    title: 'Sources',
    sources: [
      {
        id: 'pay',
        covers: 'Pay',
        line: 'Pay: wrencounty.example, Mon, Nov 9.',
        confidence: 'high',
        quote: 'The treasurer is paid $52,900 a year.',
        url: BUDGET,
        domain: DOMAIN,
      },
      {
        id: 'filing',
        covers: 'Filing',
        line: 'Filing: wrencounty.example, Mon, Nov 9.',
        confidence: 'medium',
        quote: null,
        url: FILING,
        domain: DOMAIN,
      },
      {
        id: 'votes',
        covers: 'Votes',
        line: PAGE_LINE,
        confidence: 'high',
        quote: null,
        url: RESULTS,
        domain: DOMAIN,
      },
    ],
    caution: 'Confirm with your election office.',
    testID: 'gallery.sources-sheet-card',
  },
  // A page section's sheet: one entry in the page form.
  page: {
    open: true,
    onClose: close,
    title: 'Sources',
    sources: [
      {
        id: 'term',
        covers: 'Term',
        line: PAGE_LINE,
        confidence: 'high',
        quote: null,
        url: BUDGET,
        domain: DOMAIN,
      },
    ],
    testID: 'gallery.sources-sheet-page',
  },
  // A low confidence value may have no link; its line says so.
  lowNoLink: {
    open: true,
    onClose: close,
    title: 'Sources',
    sources: [
      {
        id: 'hours',
        covers: 'Hours',
        line: 'No link to the source. Checked Mon, Nov 9.',
        confidence: 'low',
        quote: null,
        url: null,
        domain: null,
      },
    ],
    testID: 'gallery.sources-sheet-low-no-link',
  },
  withCredit: {
    open: true,
    onClose: close,
    title: 'Sources',
    sources: [
      {
        id: 'holder',
        covers: 'Holder',
        line: PAGE_LINE,
        confidence: 'high',
        quote: null,
        url: RESULTS,
        domain: DOMAIN,
      },
    ],
    credit: 'Photo: Fixture Photographer, CC BY 4.0, cropped',
    testID: 'gallery.sources-sheet-with-credit',
  },
  withFooter: {
    open: true,
    onClose: close,
    title: 'Sources',
    sources: [
      {
        id: 'pay',
        covers: 'Pay',
        line: PAGE_LINE,
        confidence: 'medium',
        quote: null,
        url: BUDGET,
        domain: DOMAIN,
      },
    ],
    footer: (
      <Button
        variant="secondary"
        label="Report a mistake"
        testID="gallery.sources-sheet-with-footer-report"
        onPress={() => undefined}
      />
    ),
    testID: 'gallery.sources-sheet-with-footer',
  },
} as const satisfies Readonly<Record<string, SourcesSheetProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
