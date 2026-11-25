import type { ColorToken } from '@/ui/tokens';

import type { AgeGateProps } from './age-gate';
import type { InteractionPreviewState } from './pressable';

const change = (): void => undefined;

/** The twelve long month names in English, as a caller reads them from the locale. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** 2026 back 120 years, newest first, as a caller builds them from the year it is. */
const YEARS = Array.from({ length: 121 }, (_, index) => 2026 - index);

/** What every state shares: the words and the lists are the caller's. */
const QUESTION = {
  years: YEARS,
  onChange: change,
  monthLabel: 'Month of birth',
  yearLabel: 'Year of birth',
  monthPlaceholder: 'Month',
  yearPlaceholder: 'Year',
  monthNames: MONTH_NAMES,
} as const;

export const STATES = {
  // Nothing is chosen for the person.
  empty: {
    ...QUESTION,
    month: null,
    year: null,
    testIDs: { month: 'gallery.age-gate-empty-month', year: 'gallery.age-gate-empty-year' },
  },
  monthOnly: {
    ...QUESTION,
    month: 3,
    year: null,
    testIDs: {
      month: 'gallery.age-gate-month-only-month',
      year: 'gallery.age-gate-month-only-year',
    },
  },
  complete: {
    ...QUESTION,
    month: 3,
    year: 1990,
    testIDs: { month: 'gallery.age-gate-complete-month', year: 'gallery.age-gate-complete-year' },
  },
} as const satisfies Readonly<Record<string, AgeGateProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
