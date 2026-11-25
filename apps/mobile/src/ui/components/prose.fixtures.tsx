import type { ColorToken } from '@/ui/tokens';

import { Link } from './link';
import type { InteractionPreviewState } from './pressable';
import type { ProseProps } from './prose';

export const STATES = {
  // A whole page: its title, sections, an unordered and an ordered list, and a link in a sentence.
  aboutPage: {
    testID: 'gallery.prose-about-page',
    blocks: [
      { kind: 'title', text: 'About the numbers' },
      {
        kind: 'paragraph',
        text: 'Every figure on an office page comes from a public record. Where a record gives no figure, the page says it is not known yet.',
      },
      { kind: 'heading', text: 'Where a figure comes from' },
      {
        kind: 'paragraph',
        text: 'Each figure names the office that published it and the day it was last checked.',
      },
      {
        kind: 'list',
        ordered: false,
        items: [
          'Pay and term length, from the Wren County budget',
          'Filing dates and fees, from the Wren County Clerk',
          'Past results, from the certified county canvass',
        ],
      },
      { kind: 'heading', text: 'When 2 sources disagree' },
      {
        kind: 'paragraph',
        text: (
          <>
            The earlier date is shown, and both sources are listed. The steps are set out in the{' '}
            <Link href="/dev/gallery" testID="gallery.prose-about-page-rules">
              filing rules
            </Link>
            .
          </>
        ),
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          'The clerk’s own notice is read first.',
          'The state calendar is read next.',
          'A date that still differs is marked, and the clerk is asked.',
        ],
      },
    ],
  },
  paragraphsOnly: {
    testID: 'gallery.prose-paragraphs-only',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A school board sets the budget of every school in its district and hires the superintendent.',
      },
      {
        kind: 'paragraph',
        text: 'In Wren County the board has 5 seats. A term is 4 years, and the seats are filled in odd years.',
      },
    ],
  },
} as const satisfies Readonly<Record<string, ProseProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
