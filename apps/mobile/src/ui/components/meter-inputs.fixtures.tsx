import type { ColorToken } from '@/ui/tokens';

import type { MeterInputsProps } from './meter-inputs';
import type { InteractionPreviewState } from './pressable';

const press = (): void => undefined;

const INPUTS = [
  {
    id: 'contest',
    sentence: 'Nobody filed against the holder in 2023.',
    unknownLabel: 'Who ran last time',
    source: 'wrencounty.example. Checked Nov 9.',
  },
  {
    id: 'margin',
    sentence: 'About 2,100 votes won it last time.',
    unknownLabel: 'Margin last time',
    source: 'wrencounty.example. Checked Nov 9.',
  },
  {
    id: 'filing',
    sentence: '$50 to file. No signatures needed.',
    unknownLabel: 'Cost to file',
    source: 'elections.fixture-state.example. Checked Oct 12.',
  },
] as const;

export const STATES = {
  known: { inputs: INPUTS, testID: 'gallery.meter-inputs-known' },
  // An input nobody knows: its name and the unknown tag, with no source line.
  unknown: {
    inputs: [{ id: 'margin', sentence: null, unknownLabel: 'Margin last time', source: null }],
    testID: 'gallery.meter-inputs-unknown',
  },
  // A known input whose proof has no source address: the sentence alone.
  knownNoSource: {
    inputs: [
      {
        id: 'population',
        sentence: 'About 14,800 people live here.',
        unknownLabel: 'People who live here',
        source: null,
      },
    ],
    testID: 'gallery.meter-inputs-known-no-source',
  },
  // The words of the source row say the confidence, so no mark is drawn before them.
  withSourceLink: {
    inputs: INPUTS,
    sourceLink: {
      confidence: null,
      text: 'Low confidence · Sources',
      onPress: press,
      testID: 'gallery.meter-inputs-with-source-link-source',
    },
    testID: 'gallery.meter-inputs-with-source-link',
  },
} as const satisfies Readonly<Record<string, MeterInputsProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
