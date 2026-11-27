import { createI18n } from '@citizenrun/shared';
import type { FieldMeta, OfficeSummary, TFunction } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { createElement, Fragment } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { OfficeActions, OfficeEntry } from '@/lib/view-models/common.types';
import { closingLineText } from '@/ui/components/deadline-line';

import { presentOfficeCard } from './present-office-card';
import type { OfficeCardContext } from './present-office-card';

// The closing text is pure and lives in C-DeadlineLine's file. The parts that draw the line load
// modules only a page or a phone can, and this project has neither; the text needs none of them.
vi.mock('@/ui/components/flag', () => ({ Flag: (): null => null }));
vi.mock('@/ui/components/text', () => ({ Text: (): null => null }));

// The typed t accepts catalog keys only; the presenter passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;
// Noon on Sunday, November 15 in New York.
const ctx = { locale: 'en', now: new FakeClock('2026-11-15T17:00:00.000Z').now() };

const noop = (): void => undefined;

function proof(confidence: FieldMeta['confidence']): FieldMeta {
  return {
    sourceUrl: 'https://wrencounty.example/budget-2026',
    quote: 'A fixture quote.',
    confidence,
    checkedAt: '2026-11-09T15:00:00.000Z',
    ruleCitation: null,
  };
}

// An invented office: the County Treasurer of Fixture Wren County in the state ZZ, not yet scored.
const OFFICE: OfficeSummary = {
  id: '01890000-0000-7000-8000-000000000101',
  slug: 'county-treasurer-wren',
  title: 'County Treasurer',
  officeTypeId: 'county-treasurer',
  level: 'county',
  electorate: 'public',
  state: 'ZZ',
  jurisdiction: {
    id: '01890000-0000-7000-8000-000000000102',
    name: 'Fixture Wren County',
    kind: 'county',
    state: 'ZZ',
    website: null,
    timezone: 'America/New_York',
  },
  district: {
    id: '01890000-0000-7000-8000-000000000103',
    tileId: 101,
    name: 'Fixture Wren County',
    level: 'county',
    geometryQuality: 'exact',
  },
  outline: null,
  placeholder: false,
  completeness: null,
  partisan: true,
  seats: 1,
  bodySize: null,
  seatsUpNext: 1,
  payAnnualCents: 5290000,
  payKind: 'salary',
  payAmountCents: 5290000,
  payPeriod: 'year',
  hoursPerWeek: 20,
  fitsDayJob: 'likely',
  fullTime: false,
  signaturesRequired: null,
  filingFeeCents: 5000,
  costToRunCents: null,
  ease: null,
  easeConfidence: null,
  impact: null,
  impactMode: 'personal',
  impactIssueId: null,
  opportunity: null,
  votesToWin: null,
  votesLow: null,
  votesHigh: null,
  votesEstimated: null,
  nextElection: {
    id: '01890000-0000-7000-8000-000000000104',
    electionDate: '2027-04-06',
    kind: 'general',
    party: null,
  },
  filingDeadline: { date: '2026-11-27', time: '17:00', timezone: 'America/New_York' },
  filingStatus: 'open',
  headlineIssueId: 'public-money',
  issues: [
    { issueId: 'public-money', relevance: 3 },
    { issueId: 'property-taxes', relevance: 3 },
  ],
  featuredOfficeholder: null,
  featuredHolderSince: null,
  openSeat: null,
  fieldMeta: { payAnnualCents: proof('high'), filingDeadline: proof('high') },
  retiredAt: null,
  viewer: { following: false, bookmarked: false, running: false, declarationId: null },
};

const ACTIONS: OfficeActions = {
  runState: 'hidden',
  runUnavailable: null,
  following: true,
  bookmarked: false,
  onRun: noop,
  onToggleFollow: noop,
  onToggleBookmark: noop,
};

const CANVAS = { element: createElement(Fragment), altText: 'A fixture canvas.' };

const CARD: OfficeCardContext = {
  reason: 'Near you',
  viewerIssueIds: [],
  onOpenSources: noop,
  onOpenEffort: noop,
  testID: 'probe.card',
};

function present(
  over: Partial<OfficeSummary> = {},
  actions: Partial<OfficeActions> = {},
  card: Partial<OfficeCardContext> = {},
) {
  const entry: OfficeEntry = {
    office: { ...OFFICE, ...over },
    href: '/office/county-treasurer-wren',
    actions: { ...ACTIONS, ...actions },
    itemKey: 'office:01890000-0000-7000-8000-000000000101',
  };
  return presentOfficeCard(entry, CANVAS, t, ctx, { ...CARD, ...card });
}

describe('presentOfficeCard', () => {
  it('unscored office has no meter row', () => {
    const props = present();
    expect(props.ease).toBeNull();
    expect(props.impact).toBeNull();
    // The rest of the card is whole before scoring.
    expect(props).toMatchObject({
      header: { illustration: 'county-treasurer', reason: 'Near you', match: 'County office' },
      canvas: CANVAS.element,
      altText: 'A fixture canvas.',
      href: '/office/county-treasurer-wren',
      onOpenMenu: null,
      itemKey: 'office:01890000-0000-7000-8000-000000000101',
      testID: 'probe.card',
    });
  });

  it('the header says why the office is shown and which of the viewer’s issues it decides', () => {
    expect(present({}, {}, { viewerIssueIds: ['property-taxes'] }).header.match).toBe(
      'Matches Property taxes',
    );
    expect(
      present({}, {}, { viewerIssueIds: ['property-taxes', 'public-money'] }).header.match,
    ).toBe('Matches Public money and Property taxes');
    // An office type this build does not know draws the fallback illustration.
    expect(present({ officeTypeId: 'zz-unknown-type' }).header.illustration).toBe('city-council');
  });

  it('the action row carries the entry’s actions', () => {
    const onRun = vi.fn();
    const onToggleFollow = vi.fn();
    const onToggleBookmark = vi.fn();
    const { actions } = present(
      {},
      {
        runState: 'unavailable',
        runUnavailable: 'closed',
        onRun,
        onToggleFollow,
        onToggleBookmark,
      },
    );
    expect(actions).toEqual({
      kind: 'office',
      layout: 'row',
      run: { state: 'unavailable', label: 'Filing closed' },
      following: true,
      bookmarked: false,
      onRun,
      onToggleFollow,
      onToggleBookmark,
      itemKey: 'office:01890000-0000-7000-8000-000000000101',
      testID: 'probe.card-actions',
    });
    expect(present().actions.run).toEqual({ state: 'hidden' });
  });

  it('scored office phrases', () => {
    const onOpenEffort = vi.fn();
    const scored = present({ ease: 72, easeConfidence: 'high', impact: 60 }, {}, { onOpenEffort });
    expect(scored.ease).toEqual({
      name: 'Ease',
      score: 72,
      phrase: 'Easier than most',
      onPress: onOpenEffort,
      itemKey: 'office:01890000-0000-7000-8000-000000000101',
    });
    expect(scored.impact).toEqual({
      name: 'Impact',
      score: 60,
      phrase: 'High on Public money',
      onPress: onOpenEffort,
      itemKey: 'office:01890000-0000-7000-8000-000000000101',
    });

    const easeOf = (ease: number, easeConfidence: FieldMeta['confidence'] | null) =>
      present({ ease, easeConfidence, impact: 10 }).ease?.phrase;
    expect(easeOf(50, 'low')).toBe('About: average to win');
    // The thirds: 67 and up, 34 to 66, 33 and down.
    expect(easeOf(100, 'medium')).toBe('Easier than most');
    expect(easeOf(67, 'medium')).toBe('Easier than most');
    expect(easeOf(66, 'medium')).toBe('Average to win');
    expect(easeOf(34, null)).toBe('Average to win');
    expect(easeOf(33, 'high')).toBe('Harder than most');
    expect(easeOf(0, 'high')).toBe('Harder than most');
    expect(easeOf(80, 'low')).toBe('About: easier than most');
    expect(easeOf(12, 'low')).toBe('About: harder than most');

    const impactOf = (impact: number, over: Partial<OfficeSummary> = {}) =>
      present({ ease: 50, easeConfidence: 'high', impact, ...over }).impact?.phrase;
    // High above 50, medium from 25 to 50, low below 25.
    expect(impactOf(51)).toBe('High on Public money');
    expect(impactOf(50)).toBe('Medium on Public money');
    expect(impactOf(25)).toBe('Medium on Public money');
    expect(impactOf(24)).toBe('Low on Public money');
    expect(impactOf(60, { headlineIssueId: null })).toBe('Does not touch your issues');
    // In single-issue mode the phrase names the issue the viewer chose.
    expect(impactOf(60, { impactMode: 'single_issue', impactIssueId: 'schools' })).toBe(
      'High on Schools',
    );
    // An issue this build has no words for leaves the phrase to the meter.
    expect(impactOf(60, { headlineIssueId: 'zz-unknown' })).toBeNull();
  });

  it('one known score still gives both meters, the other not known yet', () => {
    const easeOnly = present({ ease: 72, easeConfidence: 'high', impact: null });
    expect(easeOnly.ease?.phrase).toBe('Easier than most');
    expect(easeOnly.impact).toMatchObject({ name: 'Impact', score: null, phrase: null });
    const impactOnly = present({ ease: null, impact: 30 });
    expect(impactOnly.ease).toMatchObject({ name: 'Ease', score: null, phrase: null });
    expect(impactOnly.impact?.phrase).toBe('Medium on Public money');
  });

  it('cost line forms', () => {
    const costOf = (over: Partial<OfficeSummary>) => present(over).costLine;
    expect(costOf({ filingFeeCents: 5000, costToRunCents: null })).toBe('$50 to file.');
    expect(costOf({ filingFeeCents: 0, costToRunCents: null })).toBe('No filing fee.');
    expect(costOf({ filingFeeCents: null, costToRunCents: 120000 })).toBeNull();
    // With the cost to run, which is always an estimate.
    expect(costOf({ filingFeeCents: 5000, costToRunCents: 120000 })).toBe(
      '$50 to file. About $1,200 to run.',
    );
    expect(costOf({ filingFeeCents: 0, costToRunCents: 120000 })).toBe(
      'No filing fee. About $1,200 to run.',
    );
    expect(costOf({ filingFeeCents: 5000, costToRunCents: 120000, signaturesRequired: 25 })).toBe(
      '$50 to file. 25 signatures. About $1,200 to run.',
    );
    expect(costOf({ filingFeeCents: 5000, costToRunCents: 120000, signaturesRequired: 1 })).toBe(
      '$50 to file. 1 signature. About $1,200 to run.',
    );
    // Signatures are named only beside a fee and a cost.
    expect(costOf({ filingFeeCents: 5000, costToRunCents: null, signaturesRequired: 25 })).toBe(
      '$50 to file.',
    );
    expect(costOf({ filingFeeCents: 1250, costToRunCents: null })).toBe('$12.50 to file.');
  });

  it('closing line', () => {
    expect(present().closingLine).toBe(
      closingLineText({ state: 'open', date: 'Fri, Nov 27', time: '5:00 pm Eastern' }, t),
    );
    expect(present().closingLine).toBe(
      'Filing closes Fri, Nov 27 at 5:00 pm Eastern. Confirm with your election office.',
    );
    // No closing hour is said where no source states one.
    expect(
      present({ filingDeadline: { date: '2026-11-27', time: null, timezone: null } }).closingLine,
    ).toBe('Filing closes Fri, Nov 27. Confirm with your election office.');

    const none = present({ filingStatus: 'no_election', filingDeadline: null, nextElection: null });
    expect(none.closingLine).toBe(closingLineText({ state: 'none', date: null, time: null }, t));
    expect(none.closingLine).toBe('No election scheduled yet.');

    // The status says closed on the last day itself, before the window's own count does.
    const closed = present({
      filingStatus: 'closed',
      filingDeadline: { date: '2026-11-15', time: null, timezone: 'America/New_York' },
    });
    expect(closed.closingLine).toBe(
      closingLineText({ state: 'closed', date: 'Sun, Nov 15', time: null }, t),
    );
    expect(closed.closingLine).toBe('Filing closed Sun, Nov 15.');
    // A deadline that has passed reads closed whatever the status still says.
    expect(
      present({ filingDeadline: { date: '2026-11-02', time: null, timezone: null } }).closingLine,
    ).toBe('Filing closed Mon, Nov 2.');

    expect(present({ filingStatus: 'dates_not_known', filingDeadline: null }).closingLine).toBe(
      'Filing deadline not known yet. Confirm with your election office.',
    );
    // A date in another year carries the year.
    expect(
      present({ filingDeadline: { date: '2027-02-05', time: null, timezone: null } }).closingLine,
    ).toBe('Filing closes Feb 5, 2027. Confirm with your election office.');
  });

  it('source row confidence', () => {
    const onOpenSources = vi.fn();
    const sourceOf = (fieldMeta: OfficeSummary['fieldMeta']) =>
      present({ fieldMeta }, {}, { onOpenSources }).source;
    expect(sourceOf({ payAnnualCents: proof('high'), filingDeadline: proof('medium') })).toEqual({
      confidence: 'medium',
      text: 'Medium confidence · Sources',
      onPress: onOpenSources,
    });
    expect(sourceOf({ payAnnualCents: proof('high'), filingDeadline: proof('high') }).text).toBe(
      'High confidence · Sources',
    );
    // Pay stands on the per-period proof when there is no annual one.
    expect(sourceOf({ payAmountCents: proof('low'), filingDeadline: proof('high') })).toMatchObject(
      { confidence: 'low', text: 'Low confidence · Sources' },
    );
    // A proof the canvas does not show does not count.
    expect(
      sourceOf({
        payAnnualCents: proof('high'),
        payAmountCents: proof('low'),
        hoursPerWeek: proof('low'),
        filingFeeCents: proof('low'),
      }).confidence,
    ).toBe('high');
    expect(sourceOf({})).toEqual({ confidence: null, text: 'Sources', onPress: onOpenSources });
  });
});
