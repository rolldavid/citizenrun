import type { ColorToken } from '@/ui/tokens';

import type { ActionRowProps } from './action-row';
import type { InteractionPreviewState } from './pressable';

/** What every state shares: one fixture office, neither followed nor bookmarked. */
const OFFICE = {
  kind: 'office',
  following: false,
  bookmarked: false,
  onRun: () => undefined,
  onToggleFollow: () => undefined,
  onToggleBookmark: () => undefined,
  itemKey: 'fixture-office',
} as const;

export const STATES = {
  // Before Run exists: Follow takes the two equal slots.
  rowHidden: { ...OFFICE, run: { state: 'hidden' }, testID: 'gallery.action-row-row-hidden' },
  rowHiddenDone: {
    ...OFFICE,
    run: { state: 'hidden' },
    following: true,
    bookmarked: true,
    testID: 'gallery.action-row-row-hidden-done',
  },
  rowIdle: { ...OFFICE, run: { state: 'idle' }, testID: 'gallery.action-row-row-idle' },
  rowRunning: { ...OFFICE, run: { state: 'running' }, testID: 'gallery.action-row-row-running' },
  // Run cannot be taken: the button says why.
  rowUnavailable: {
    ...OFFICE,
    run: { state: 'unavailable', label: 'Filing closed' },
    testID: 'gallery.action-row-row-unavailable',
  },
  // The office page's bar.
  sticky: {
    ...OFFICE,
    layout: 'sticky',
    run: { state: 'idle' },
    testID: 'gallery.action-row-sticky',
  },
  stickyDone: {
    ...OFFICE,
    layout: 'sticky',
    run: { state: 'idle' },
    following: true,
    bookmarked: true,
    testID: 'gallery.action-row-sticky-done',
  },
  stickyHidden: {
    ...OFFICE,
    layout: 'sticky',
    run: { state: 'hidden' },
    testID: 'gallery.action-row-sticky-hidden',
  },
  // The desktop action card.
  stacked: {
    ...OFFICE,
    layout: 'stacked',
    run: { state: 'idle' },
    testID: 'gallery.action-row-stacked',
  },
  stackedHidden: {
    ...OFFICE,
    layout: 'stacked',
    run: { state: 'hidden' },
    testID: 'gallery.action-row-stacked-hidden',
  },
  // The ids a screen names for the three parts, as the office page does.
  withPartTestIDs: {
    ...OFFICE,
    run: { state: 'idle' },
    partTestIDs: {
      run: 'office.run-button',
      follow: 'office.follow-button',
      bookmark: 'office.bookmark-button',
    },
    testID: 'office.actions',
  },
} as const satisfies Readonly<Record<string, ActionRowProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
