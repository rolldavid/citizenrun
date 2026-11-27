import { createI18n } from '@citizenrun/shared';
import type { OfficeSummary, TFunction } from '@citizenrun/shared';
import {
  FIXTURE_CTX,
  FIXTURE_OFFICE,
  NO_PHOTO_OPTIONS,
} from '../../__fixtures__/office.fixtures.ts';
import type { CanvasColors } from '../../colors.ts';
import { buildRunAgainstModel } from '../../model/run-against.ts';
import type { RunAgainstData, RunAgainstModel } from '../../model/run-against.ts';

// What the tests of the regions and the models share.

// The typed t accepts catalog keys only; the code under test passes each key as a plain string.
export const t = createI18n().getFixedT('en') as unknown as TFunction;

/** Colors that name their own role, so a test reads which role an element took. */
export const COLORS: CanvasColors = {
  theme: 'light',
  bg: 'c-bg',
  surface: 'c-surface',
  text: 'c-text',
  textSecondary: 'c-text-secondary',
  ruleSoft: 'c-rule-soft',
  accent: 'c-accent',
  highlight: 'c-highlight',
  onHighlight: 'c-on-highlight',
  posterBg: 'c-poster-bg',
  posterText: 'c-poster-text',
  posterTextSecondary: 'c-poster-text-secondary',
  issue: {
    'property-taxes': { fill: 'c-issue-fill', poster: 'c-issue-poster', on: 'c-issue-on' },
  },
};

export const MONO = { fontFamily: 'Chivo Mono', fontWeight: '500' };
export const REGULAR = { fontFamily: 'Special Gothic', fontWeight: '400' };
export const MEDIUM = { fontFamily: 'Special Gothic', fontWeight: '500' };
export const BOLD = { fontFamily: 'Special Gothic', fontWeight: '700' };

/** The fixture office with some of its fields replaced. */
export function officeWith(overrides: Partial<OfficeSummary>): OfficeSummary {
  return { ...FIXTURE_OFFICE, ...overrides };
}

/** The data of a canvas for an office: its featured officeholder is the holder shown. */
export function dataOf(office: OfficeSummary): RunAgainstData {
  return { office, featuredPerson: office.featuredOfficeholder, lastResult: null };
}

/** The model of a canvas at the fixtures' instant, with the photo slot off. */
export function modelOf(data: RunAgainstData): RunAgainstModel {
  return buildRunAgainstModel(data, t, FIXTURE_CTX, NO_PHOTO_OPTIONS);
}

/** A filing deadline in the fixture county's zone. */
export function deadlineOn(date: string): NonNullable<OfficeSummary['filingDeadline']> {
  return { date, time: null, timezone: 'America/Los_Angeles' };
}
