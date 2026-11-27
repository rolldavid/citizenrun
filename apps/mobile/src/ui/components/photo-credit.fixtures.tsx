import type { ColorToken } from '@/ui/tokens';

import type { PhotoCreditProps } from './photo-credit';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  ccBy: { text: 'Fixture Photographer, CC BY 4.0, cropped' },
  publicDomain: { text: 'Fixture Photographer, public domain' },
  // Long enough to take a second line in the narrowest cell.
  long: {
    text: 'Fixture Photographer for the Fixture Wren County Historical Society, CC BY-SA 4.0, cropped',
  },
} as const satisfies Readonly<Record<string, PhotoCreditProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
