import { FIELD_REPORT_FIELDS, createI18n } from '@citizenrun/shared';
import type { OfficeDetail, TFunction } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/office/view-models/office.fixtures';
import type { OfficeReadyData, OfficeViewModel } from '@/features/office/view-models/office.types';

import {
  fieldLabel,
  formatBudgetFigure,
  formatPayFigure,
  pageFieldMeta,
  presentActionCard,
  presentBoard,
  presentBudget,
  presentControls,
  presentDeal,
  presentFiling,
  presentIssueChips,
  presentNotices,
  presentPageSources,
  presentPay,
  presentRunning,
  presentTracks,
  presentWhere,
  reportFieldLabel,
} from './present-office';
import type { OfficePageActions } from './present-office';

// The closing text and the map row's words are pure and live in their components' files. The parts
// that draw them load modules only a page or a phone can, and this project has neither. The closing
// text needs none of them; the map row's words are stood in for here and read for real where the
// page is drawn.
vi.mock('@/ui/components/flag', () => ({ Flag: (): null => null }));
vi.mock('@/ui/components/text', () => ({ Text: (): null => null }));
vi.mock('@/ui/components/mini-map-still', () => ({
  miniMapText: (): { levelLabel: string; approximateText: null; openLabel: string } => ({
    levelLabel: 'the level',
    approximateText: null,
    openLabel: 'the open label',
  }),
}));

// The typed t accepts catalog keys only; the presenters pass each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;
const ctx = { locale: 'en', now: new FakeClock('2026-11-15T17:00:00.000Z').now() };

function dataOf(vm: OfficeViewModel): OfficeReadyData {
  if (vm.status !== 'ready') {
    throw new Error('the fixture is not a ready state');
  }
  return vm.data;
}

const READY = dataOf(fixtures.officeReady);
const OFFICE = READY.office;

function officeWith(over: Partial<OfficeDetail>): OfficeDetail {
  return { ...OFFICE, ...over };
}

function pageActions(): OfficePageActions {
  return { openSources: vi.fn(), openSteps: vi.fn(), openReport: vi.fn(), scrollToBlock: vi.fn() };
}

/** The value a pay row prints, by the row's key. */
function payRow(office: OfficeDetail, key: string): string | null | undefined {
  return presentPay(office, t, ctx, pageActions()).rows.find((row) => row.key === key)?.value.text;
}

describe('the deal', () => {
  it('deal line has pay and hours only', () => {
    const page = pageActions();
    const parts = presentDeal(OFFICE, t, ctx, page);
    expect(parts.map((part) => part.text)).toEqual([
      'Pays $52,900 a year plus benefits.',
      'About 20 hours a week.',
    ]);
    expect(parts.map((part) => part.id)).toEqual(['pay', 'hours']);
    // Pay opens the section that explains it; hours opens nothing.
    expect(parts[0]?.figure).toBe('$52,900');
    parts[0]?.onPress?.();
    expect(page.scrollToBlock).toHaveBeenCalledWith('pay');
    expect(parts[1]?.onPress).toBeUndefined();
  });

  it('deal parts say not known yet', () => {
    const parts = presentDeal(dataOf(fixtures.officeAllUnknown).office, t, ctx, pageActions());
    expect(parts.map((part) => part.text)).toEqual(['Pay not known yet.', 'Hours not known yet.']);
    expect(parts[0]?.onPress).toBeUndefined();
    expect(parts[0]?.figure).toBeUndefined();
  });

  it('the issues are small chips, and a choice of one in single-issue mode', () => {
    const shown = presentIssueChips(OFFICE, READY.issues, null, t);
    expect(shown.map((chip) => chip.testID)).toEqual(
      OFFICE.issueRelevance.map((each) => `office.issue-${each.issueId}`),
    );
    expect(shown.every((chip) => chip.size === 'sm' && chip.onPress === undefined)).toBe(true);
    expect(shown.every((chip) => chip.name !== '')).toBe(true);

    const single = dataOf(fixtures.officeSingleIssue);
    const onSelect = vi.fn();
    const chosen = presentIssueChips(
      single.office,
      single.issues,
      { issueId: 'property-taxes', onSelect },
      t,
    );
    expect(chosen.filter((chip) => chip.selected === true).map((chip) => chip.issueId)).toEqual([
      'property-taxes',
    ]);
    chosen.find((chip) => chip.issueId === 'public-money')?.onPress?.();
    expect(onSelect).toHaveBeenCalledWith('public-money');
  });
});

describe('where it is', () => {
  it('the map row, and the line for an office only members vote for', () => {
    const onOpen = vi.fn();
    const where = presentWhere(OFFICE, { onOpen }, t);
    expect(where.map).toMatchObject({
      outline: OFFICE.outline,
      placeName: OFFICE.district.name,
      levelLabel: 'the level',
      onPress: onOpen,
      testID: 'office.mini-map',
    });
    expect(where.membersLine).toBeNull();
    expect(
      presentWhere(dataOf(fixtures.officeMembersOnly).office, { onOpen: null }, t).membersLine,
    ).toBe('Only members vote in this election.');
  });
});

describe('the notices', () => {
  it('notices in order', () => {
    const onOpenSource = vi.fn();
    const notices = presentNotices(
      officeWith({
        retiredAt: '2026-10-01T00:00:00.000Z',
        placeholder: true,
        filingStatus: 'closed',
        jurisdiction: { ...OFFICE.jurisdiction, website: 'https://wrencounty.example' },
      }),
      t,
      onOpenSource,
    );
    expect(notices.map((notice) => notice.testID)).toEqual([
      'office.notice-retired',
      'office.notice-placeholder',
      'office.notice-closed',
    ]);
    expect(notices.map((notice) => notice.kind)).toEqual(['warning', 'info', 'info']);
    expect(notices[1]?.action?.label).toBe('Ask the clerk');
    notices[1]?.action?.onPress();
    expect(onOpenSource).toHaveBeenCalledWith('https://wrencounty.example');
  });

  it('a placeholder with no website offers no clerk', () => {
    const notices = presentNotices(
      officeWith({
        placeholder: true,
        jurisdiction: { ...OFFICE.jurisdiction, website: null },
      }),
      t,
      vi.fn(),
    );
    expect(notices.map((notice) => notice.key)).toEqual(['placeholder']);
    expect(notices[0]?.action).toBeUndefined();
  });

  it('minimal lists the missing act-on fields', () => {
    const notices = presentNotices(dataOf(fixtures.officeMinimal).office, t, vi.fn());
    expect(notices.map((notice) => notice.text)).toEqual([
      'Not known yet: pay, filing fee, and where to file.',
    ]);
    // With every act-on value known the notice is not drawn.
    expect(presentNotices(officeWith({ completeness: 'minimal' }), t, vi.fn())).toEqual([]);
  });

  it('a complete office with an open window has no notice', () => {
    expect(presentNotices(OFFICE, t, vi.fn())).toEqual([]);
  });
});

describe('pay and time', () => {
  it('pay figure compacts from $100,000', () => {
    expect(formatPayFigure(17_400_000, t, ctx)).toBe('$174K');
    expect(formatPayFigure(5_290_000, t, ctx)).toBe('$52,900');
    expect(formatBudgetFigure(8_400_000_000, t, ctx)).toBe('$84M');
    expect(formatBudgetFigure(99_999_900, t, ctx)).toBe('$999,999');
  });

  it('the pay is stated once, with its period and its sentence', () => {
    const { figure } = presentPay(OFFICE, t, ctx, pageActions());
    if (figure.kind !== 'number') {
      throw new Error('a paid office states its pay as a number');
    }
    expect(figure.number.value).toEqual({ text: '$52,900', about: false });
    expect(figure.number.label).toBe('a year');
    expect(figure.number.accessibilityLabel).toBe('Pays $52,900 a year.');
    expect(figure.number.testID).toBe('office.field-payAmountCents');

    const unknown = presentPay(dataOf(fixtures.officeAllUnknown).office, t, ctx, pageActions());
    if (unknown.figure.kind !== 'number') {
      throw new Error('an unknown pay is the number in its unknown form');
    }
    expect(unknown.figure.number.value.text).toBeNull();
    expect(unknown.figure.number.accessibilityLabel).toBe('Pay not known yet.');
    // An unknown is said once: a section with no proof draws no source row.
    expect(unknown.sources).toEqual([]);
  });

  it('unpaid', () => {
    const pay = presentPay(officeWith({ payKind: 'none' }), t, ctx, pageActions());
    expect(pay.figure).toEqual({
      kind: 'unpaid',
      text: 'Unpaid',
      testID: 'office.field-payAmountCents',
    });
  });

  it('benefits', () => {
    expect(payRow(officeWith({ benefits: [] }), 'benefits')).toBe('None');
    expect(payRow(officeWith({ benefits: null }), 'benefits')).toBeNull();
    expect(payRow(officeWith({ benefits: ['health', 'retirement'] }), 'benefits')).toBe(
      'Health insurance and Retirement',
    );
  });

  it('fits around a job with meeting times', () => {
    expect(
      payRow(officeWith({ fitsDayJob: 'likely', meetingTimes: ['daytime'] }), 'fitsDayJob'),
    ).toBe('Likely. Meets in the daytime.');
    expect(payRow(officeWith({ fitsDayJob: 'yes', meetingTimes: null }), 'fitsDayJob')).toBe('Yes');
    expect(payRow(officeWith({ fitsDayJob: null }), 'fitsDayJob')).toBeNull();
  });

  it('the rows of the ready office', () => {
    const { rows } = presentPay(OFFICE, t, ctx, pageActions());
    expect(rows.map((row) => [row.label, row.value.text, row.value.about])).toEqual([
      ['Hours', '20 hours a week', true],
      ['Term', '4 years', false],
      ['Benefits', 'Health insurance and Retirement', false],
      ['Fits around a job', 'Likely. Meets in the daytime.', false],
      ['Pay over one term', '$211,600', false],
      ['Pay per hour', '$50.87 an hour', true],
      ['Pay changes', OFFICE.payChangeNote, false],
      ['Term limit', OFFICE.termLimitTerms === null ? null : expect.any(String), false],
    ]);
    expect(rows.map((row) => row.testID)).toContain('office.field-hoursPerWeek');
    // Full-time is said in words, and the rate is drawn only where it is known.
    expect(payRow(officeWith({ fullTime: true }), 'hoursPerWeek')).toBe('Full-time');
    expect(payRow(officeWith({ effectiveHourlyCents: null }), 'effectiveHourlyCents')).toBe(
      undefined,
    );
  });

  it('a known row with a proof opens its source', () => {
    const page = pageActions();
    const { rows } = presentPay(OFFICE, t, ctx, page);
    const term = rows.find((row) => row.key === 'termYears');
    term?.onPress?.();
    expect(page.openSources).toHaveBeenCalledTimes(1);
    expect(page.openSources).toHaveBeenCalledWith('Term', [
      expect.objectContaining({ covers: 'Term' }),
    ]);
    // A value that is not known opens nothing.
    const unknown = presentPay(officeWith({ termYears: null }), t, ctx, page);
    expect(unknown.rows.find((row) => row.key === 'termYears')?.onPress).toBeUndefined();
  });

  it('one source row per distinct link', () => {
    const page = pageActions();
    const payProof = OFFICE.fieldMeta.payAmountCents ?? OFFICE.fieldMeta.payAnnualCents;
    const termProof = OFFICE.fieldMeta.termYears;
    if (payProof === undefined || termProof === undefined) {
      throw new Error('the ready office has a proof for its pay and for its term');
    }
    const office = officeWith({
      fieldMeta: {
        payAmountCents: payProof,
        payAnnualCents: payProof,
        benefits: payProof,
        termYears: { ...termProof, sourceUrl: 'https://wrencounty.example/code/terms' },
      },
    });
    const { sources } = presentPay(office, t, ctx, page);
    expect(sources.map((source) => source.testID)).toEqual([
      'office.source-link-pay-1',
      'office.source-link-pay-2',
    ]);
    // Each row opens the sheet with every source of the section.
    sources[1]?.onPress();
    expect(page.openSources).toHaveBeenCalledWith('Sources', [
      expect.objectContaining({ url: payProof.sourceUrl }),
      expect.objectContaining({ url: 'https://wrencounty.example/code/terms' }),
    ]);
  });
});

describe('what it controls, and the budget', () => {
  it('each power opens its own source', () => {
    const page = pageActions();
    const controls = presentControls(OFFICE, READY.issues, t, ctx, page);
    expect(controls.none).toBeNull();
    expect(controls.rows.map((row) => row.testID)).toEqual(
      OFFICE.powers.map((power) => `office.power-${power.powerId}`),
    );
    const words = new Set(['Decides this', 'Shares the decision', 'Indirect']);
    expect(controls.rows.every((row) => row.relevance !== null && words.has(row.relevance))).toBe(
      true,
    );
    controls.rows[0]?.onPress();
    expect(page.openSources).toHaveBeenCalledWith(OFFICE.powers[0]?.name, [
      expect.objectContaining({ covers: OFFICE.powers[0]?.name }),
    ]);
  });

  it('no powers', () => {
    const controls = presentControls(
      officeWith({ powers: [] }),
      READY.issues,
      t,
      ctx,
      pageActions(),
    );
    expect(controls.rows).toEqual([]);
    expect(controls.none).toBe('What this office controls is not known yet.');
  });

  it('a power checked at no known time names its source alone', () => {
    const [first] = OFFICE.powers;
    if (first === undefined) {
      throw new Error('the ready office has a power');
    }
    const page = pageActions();
    const controls = presentControls(
      officeWith({ powers: [{ ...first, checkedAt: null }] }),
      READY.issues,
      t,
      ctx,
      page,
    );
    controls.rows[0]?.onPress();
    expect(page.openSources).toHaveBeenCalledWith(first.name, [
      expect.objectContaining({ line: 'wrencounty.example' }),
    ]);
  });

  it('the budget', () => {
    const budget = presentBudget(OFFICE, t, ctx, pageActions());
    expect(budget.number.value).toEqual({ text: '$84M', about: false });
    expect(budget.number.label).toBe('Budget, 2024');
    expect(budget.number.accessibilityLabel).toBe('Budget $84M.');
    expect(budget.sources.map((source) => source.testID)).toEqual(['office.source-link-budget-1']);

    const unknown = presentBudget(
      officeWith({ budget: { cents: null, year: null, meta: null } }),
      t,
      ctx,
      pageActions(),
    );
    expect(unknown.number.label).toBe('Budget');
    expect(unknown.number.accessibilityLabel).toBe('Budget not known yet.');
    expect(unknown.sources).toEqual([]);
  });
});

describe('the board and filing', () => {
  it('board rows', () => {
    const rows = presentBoard(dataOf(fixtures.officeBoard).office, t);
    expect(rows?.map((row) => `${row.label}: ${String(row.value.text)}`)).toEqual([
      'Seats up next: 3 of 7 seats are up',
      'Majority: 4 make a majority',
      'Democratic: 4 members',
      'Republican: 3 members',
    ]);
    expect(rows?.map((row) => row.testID)).toEqual([
      'office.field-seatsUpNext',
      'office.field-majority',
      'office.field-party-democratic',
      'office.field-party-republican',
    ]);
    expect(presentBoard(OFFICE, t)).toBeNull();
  });

  it('party seat by caucus', () => {
    const filing = presentFiling(
      dataOf(fixtures.officePartySelection).office,
      t,
      ctx,
      pageActions(),
    );
    expect(filing.partySeat?.sentence).toBe('Filled at a party caucus, not by filing.');
    expect(filing.partySeat?.quote).toBe('“Precinct committee members are chosen at the caucus.”');
    expect(filing.partySeat?.source?.testID).toBe('office.source-link-filing-1');
    // The rows under the sentence stand on the same source, which is not listed twice.
    expect(filing.sources).toEqual([]);
    expect(filing.deadline).toBeNull();
    expect(filing.steps).toBeNull();
  });

  it('the deadline, the rows and the way to the steps', () => {
    const page = pageActions();
    const filing = presentFiling(OFFICE, t, ctx, page);
    expect(filing.partySeat).toBeNull();
    expect(filing.deadline?.testID).toBe('office.field-filingDeadline');
    expect(filing.deadline?.state).toBe('open');
    expect(filing.deadline?.daysLeft).toBe(12);
    expect(filing.rows.map((row) => [row.label, row.value.text])).toEqual([
      ['Filing fee', '$50'],
      ['Signatures', '25'],
      ['Where to file', OFFICE.whereToFile],
      ['Election day', 'Tuesday, April 6, 2027'],
    ]);
    expect(filing.steps?.label).toBe('See the filing steps');
    filing.steps?.onPress();
    expect(page.openSteps).toHaveBeenCalledTimes(1);
    // No fee is a known value, said in words.
    const free = presentFiling(officeWith({ filingFeeCents: 0 }), t, ctx, page);
    expect(free.rows[0]?.value.text).toBe('No fee');
  });

  it('no election leaves the deadline unknown and no steps', () => {
    const filing = presentFiling(dataOf(fixtures.officeNoElection).office, t, ctx, pageActions());
    expect(filing.deadline?.state).toBe('unknown');
    expect(filing.deadline?.source).toBeNull();
    expect(filing.steps).toBeNull();
    expect(filing.rows.find((row) => row.key === 'electionDate')?.value.text).toBeNull();
  });

  it('the tracks of the next election', () => {
    const page = pageActions();
    const steps = presentTracks(OFFICE.nextElectionDetail, t, ctx, page);
    expect(steps.none).toBeNull();
    expect(steps.tracks.map((track) => track.name)).toEqual(['Nonpartisan']);
    expect(steps.tracks[0]?.rows.map((row) => row.label)).toEqual([
      'Opens',
      'Closes',
      'Petitions open',
      'Petitions due',
      'Fee',
      'Signatures',
      'Where to file',
    ]);
    expect(steps.tracks[0]?.rows.find((row) => row.key === 'feeCents')?.value.text).toBe('$50');
    expect(steps.caution).toBe('Confirm with your election office.');
    steps.tracks[0]?.source.onPress();
    expect(page.openSources).toHaveBeenCalledWith('Nonpartisan', [
      expect.objectContaining({ covers: 'Nonpartisan' }),
    ]);

    const none = presentTracks(null, t, ctx, page);
    expect(none.tracks).toEqual([]);
    expect(none.none).toBe('The filing steps are not known yet.');
  });
});

describe('labels and sources', () => {
  it('field labels cover the report list', () => {
    const labels = FIELD_REPORT_FIELDS.map((field) => reportFieldLabel(field, t));
    expect(labels).toHaveLength(24);
    for (const label of labels) {
      expect(label).not.toBe('');
      expect(label).not.toContain('office:');
      expect(label).not.toContain('_');
    }
    const keys = [...Object.keys(pageFieldMeta(OFFICE)), 'partySelection', 'electorateCount'];
    expect(keys).toContain('budget');
    expect(keys).toContain('electionDate');
    for (const key of keys) {
      const label = fieldLabel(key, t);
      expect(label, key).not.toBe('');
      expect(label, key).not.toBe(key);
      expect(label, key).not.toContain('office:');
    }
  });

  it('the page lists each distinct source once', () => {
    const sources = presentPageSources(OFFICE, t, ctx);
    const links = new Set(
      Object.values(pageFieldMeta(OFFICE)).flatMap((proof) =>
        proof === undefined || proof.sourceUrl === null ? [] : [proof.sourceUrl],
      ),
    );
    expect(sources.filter((source) => source.url !== null)).toHaveLength(links.size);
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
    expect(presentPageSources(dataOf(fixtures.officeAllUnknown).office, t, ctx)).toEqual([]);
  });
});

describe('who is running, and the action card', () => {
  it('nobody has filed', () => {
    const running = presentRunning(READY.candidates, t, ctx);
    expect(running.none).toBe('Nobody has filed yet.');
    expect(running.rows).toEqual([]);
    expect(running.showAll).toBeNull();
    expect(running.count).toBe('0');
  });

  it('show all', () => {
    const running = presentRunning(dataOf(fixtures.officeCandidates).candidates, t, ctx);
    expect(running.rows.map((row) => row.tag)).toEqual([
      { label: 'Filed', variant: 'solid' },
      { label: 'Committee registered', variant: 'outline' },
    ]);
    expect(running.rows[1]?.line).toBe('Registered a campaign committee');
    expect(running.rows.map((row) => row.testID)).toEqual([
      'office.candidate-01890000-0000-7000-8000-000000000121',
      'office.candidate-01890000-0000-7000-8000-000000000122',
    ]);
    expect(running.showAll?.label).toBe('Show all 3');
    expect(running.none).toBeNull();
    expect(running.count).toBe('3');
  });

  it('the action card counts the days beside their date', () => {
    const open = presentActionCard(OFFICE, t, ctx);
    expect(open.days).toEqual({ figure: '12', label: '12 days left to file' });
    expect(open.closingLine).toContain('Nov 27');
    expect(open.ease.score).toBeNull();
    expect(open.impact.testID).toBe('office.action-card-impact');

    // No day count where filing is not open: the closing line stands alone.
    const notOpen = {
      officeNoElection: fixtures.officeNoElection,
      officeClosed: fixtures.officeClosed,
      officeNotOpenYet: fixtures.officeNotOpenYet,
    };
    for (const [name, vm] of Object.entries(notOpen)) {
      const card = presentActionCard(dataOf(vm).office, t, ctx);
      expect(card.days, name).toBeNull();
      expect(card.closingLine, name).not.toBe('');
    }
    expect(presentActionCard(dataOf(fixtures.officeAllUnknown).office, t, ctx).days).toBeNull();
  });
});
