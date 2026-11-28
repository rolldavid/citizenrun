import { createI18n } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/office/view-models/office.fixtures';
import type {
  OfficeFieldReport,
  OfficeReadyData,
  OfficeViewModel,
} from '@/features/office/view-models/office.types';
import { NowOverrideContext } from '@/lib/now';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { OfficeScreenView } from './office-screen';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A drawing of the app loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));

const FIXTURES: Readonly<Record<string, OfficeViewModel>> = fixtures;
/** Noon on Sunday, November 15 in New York: the time the fixtures are written for. */
const NOW = new Date('2026-11-15T17:00:00.000Z');
const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;
const CAUTION = 'Confirm with your election office.';
// The typed t accepts catalog keys of one namespace; the sentences read here are in several.
const english = createI18n().getFixedT('en') as unknown as TFunction;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: OfficeViewModel, options: RenderWithProvidersOptions = {}): void {
  cleanup();
  renderWithProviders(
    <NowOverrideContext.Provider value={NOW}>
      <OfficeScreenView vm={vm} />
    </NowOverrideContext.Provider>,
    options,
  );
}

function dataOf(vm: OfficeViewModel): OfficeReadyData {
  if (vm.status !== 'ready') {
    throw new Error('the fixture is not a ready state');
  }
  return vm.data;
}

/** A ready fixture with its field report's callbacks replaced. */
function withReport(vm: OfficeViewModel, over: Partial<OfficeFieldReport>): OfficeViewModel {
  const data = dataOf(vm);
  if (vm.status !== 'ready' || data.fieldReport === null) {
    throw new Error('the fixture has no field report');
  }
  return { ...vm, data: { ...data, fieldReport: { ...data.fieldReport, ...over } } };
}

/** What a screen reader calls an element: its label, or the words in it. */
function nameOf(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent).trim();
}

/** The block of the page that holds an element: a direct child of the scroll area's content. */
function sectionOf(element: HTMLElement): HTMLElement {
  const first = screen.getByTestId('office.hero').parentElement;
  const content = first?.parentElement ?? null;
  let block: HTMLElement | null = element;
  while (block !== null && block.parentElement !== content) {
    block = block.parentElement;
  }
  if (block === null) {
    throw new Error('the element is in no block of the page');
  }
  return block;
}

/**
 * Tells a view its size, as the page does once it is laid out. jsdom lays nothing out, so the
 * handler the page keeps on the element is called directly:
 * https://github.com/necolas/react-native-web/blob/0.21.2/packages/react-native-web/src/modules/useElementLayout/index.js
 */
function layOut(element: Element, width: number): void {
  const handler: unknown = Reflect.get(element, '__reactLayoutHandler');
  if (typeof handler !== 'function') {
    throw new Error('the view listens for no layout');
  }
  act(() => {
    Reflect.apply(handler, element, [
      { nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } },
    ]);
  });
}

describe('OfficeScreenView', () => {
  /** Draws every fixture at one window size and checks what holds for each of them. */
  function drawsEveryFixture(viewport: readonly [number, number], theme: 'light' | 'dark'): void {
    setViewport(...viewport);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      draw(vm, { theme });
      const root =
        vm.status === 'loading'
          ? screen.getByTestId('office.loading')
          : screen.getByTestId('office.screen');
      expect(root.textContent, name).not.toContain('{{');
      expect(root.textContent, name).not.toContain('office:');
      // Every control has a role, a name and an id a test can find it by.
      const controls = [
        ...screen.queryAllByRole('button'),
        ...screen.queryAllByRole('link'),
        ...screen.queryAllByRole('textbox'),
      ];
      for (const control of controls) {
        expect(nameOf(control), name).not.toBe('');
        expect(control.getAttribute('data-testid') ?? '', `${name}: ${nameOf(control)}`).not.toBe(
          '',
        );
      }
      if (vm.status === 'ready') {
        // The app bar's title is the page's one level 1 heading.
        expect(
          screen.getByRole('heading', { level: 1, name: vm.data.office.title }),
          name,
        ).toBeTruthy();
        expect(screen.getByTestId('office.deal-line'), name).toBeTruthy();
      }
    }
    setViewport(...COMPACT);
  }

  it('renders every fixture', { timeout: 30_000 }, () => {
    expect(Object.keys(FIXTURES).length).toBeGreaterThanOrEqual(32);
    drawsEveryFixture(COMPACT, 'light');
  });

  it('renders every fixture beside the action card', { timeout: 30_000 }, () => {
    drawsEveryFixture(EXPANDED, 'dark');
  });

  it('run is hidden', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    expect(screen.queryByTestId('office.run-button')).toBeNull();
    expect(screen.queryByText(/^Run/u)).toBeNull();
    expect(nameOf(screen.getByTestId('office.follow-button'))).toBe('Follow');
    expect(nameOf(screen.getByTestId('office.bookmark-button'))).toBe('Bookmark');

    draw(fixtures.officeTwoActions);
    expect(screen.queryByTestId('office.run-button')).toBeNull();
    expect(nameOf(screen.getByTestId('office.follow-button'))).toBe('Following');
    expect(nameOf(screen.getByTestId('office.bookmark-button'))).toBe('Bookmarked');
  });

  it('the two actions call the view-model', () => {
    setViewport(...COMPACT);
    const onToggleFollow = vi.fn();
    const onToggleBookmark = vi.fn();
    const data = dataOf(fixtures.officeReady);
    draw({
      ...fixtures.officeReady,
      status: 'ready',
      refreshing: false,
      stale: false,
      data: { ...data, actions: { ...data.actions, onToggleFollow, onToggleBookmark } },
    });
    fireEvent.click(screen.getByTestId('office.follow-button'));
    fireEvent.click(screen.getByTestId('office.bookmark-button'));
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });

  it('later sections are absent', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    for (const name of ['Results', 'How the district votes', 'How hard, how much', 'Posts']) {
      expect(screen.queryByRole('heading', { name }), name).toBeNull();
    }
    expect(screen.queryByTestId('office.share')).toBeNull();
    // The sections of this page, in their order.
    expect(screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      'The deal',
      'Where it is',
      'Pay and time',
      'What it controls',
      'Budget',
      'Who holds it',
      'Filing',
      'Sources',
      'Who is running',
    ]);
    // The board's section is drawn for a board alone.
    draw(fixtures.officeBoard);
    expect(screen.getByRole('heading', { name: 'Board control' })).toBeTruthy();
    expect(screen.getByTestId('office.field-seatsUpNext').textContent).toContain(
      '3 of 7 seats are up',
    );
  });

  it('every act-on field shows its footing', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    // The pay: a source row in its section.
    const pay = screen.getByTestId('office.field-payAmountCents');
    expect(nameOf(pay)).toBe('Pays $52,900 a year.');
    expect(within(sectionOf(pay)).getByTestId('office.source-link-pay-1')).toBeTruthy();
    // The fee and the place: each row is a button that opens its source.
    for (const field of ['filingFeeCents', 'whereToFile']) {
      const row = screen.getByTestId(`office.field-${field}`);
      expect(row.getAttribute('role'), field).toBe('button');
    }
    // The deadline: its own source row inside the block.
    const deadline = screen.getByTestId('office.field-filingDeadline');
    expect(within(deadline).getByTestId('office.source-link-deadline')).toBeTruthy();

    fireEvent.click(screen.getByTestId('office.field-filingFeeCents'));
    const sheet = screen.getByTestId('office.sources-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Filing fee' })).toBeTruthy();
    expect(within(sheet).getAllByRole('link')).toHaveLength(1);

    draw(fixtures.officeAllUnknown);
    for (const field of ['payAmountCents', 'filingFeeCents', 'whereToFile', 'filingDeadline']) {
      const shown = screen.getByTestId(`office.field-${field}`);
      const words = `${shown.getAttribute('aria-label') ?? ''} ${shown.textContent}`;
      expect(words, field).toMatch(/not known yet/iu);
    }
    // An unknown is said once: no section of an office with no proof draws a source row.
    expect(screen.queryByTestId('office.source-link-pay-1')).toBeNull();
    expect(screen.queryByTestId('office.source-link-deadline')).toBeNull();
    expect(screen.queryByTestId('office.sources-open-1')).toBeNull();
  });

  it('the deadline has its four parts', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    const block = screen.getByTestId('office.field-filingDeadline');
    expect(block.textContent).toContain('Closes Fri, Nov 27 at 5:00 pm Eastern.');
    const source = within(block).getByTestId('office.source-link-deadline');
    expect(nameOf(source)).toMatch(/(High|Medium|Low) confidence/u);
    const filing = sectionOf(block);
    expect(filing.textContent.split(CAUTION)).toHaveLength(2);
    // The block's wrapper is what a journey's screenshot masks.
    expect(screen.getByTestId('office.deadline-live').contains(block)).toBe(true);
  });

  it('deadline conflict', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeDeadlineConflict);
    const filing = sectionOf(screen.getByTestId('office.field-filingDeadline'));
    // A warning that names both dates, above the block, which shows the earlier one.
    const warning = within(filing).getByText(/^Two sources give different dates/u);
    expect(warning.textContent).toContain('Fri, Nov 27');
    expect(warning.textContent).toContain('Mon, Nov 30');
    expect(screen.getByTestId('office.field-filingDeadline').textContent).toContain(
      'Closes Fri, Nov 27',
    );
  });

  it('seven days', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeDeadlineSoon);
    const block = screen.getByTestId('office.field-filingDeadline');
    expect(block.textContent).toContain('5 days to file');
    // Never a day count without its date.
    expect(block.textContent).toMatch(/Closes \w{3}, Nov 20/u);
  });

  it('opening the sources sheet', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    expect(screen.queryByTestId('office.sources-sheet')).toBeNull();
    const rows = screen.getAllByTestId(/^office\.sources-open-\d+$/u);
    fireEvent.click(screen.getByTestId('office.sources-open-1'));
    const sheet = screen.getByTestId('office.sources-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Sources' })).toBeTruthy();
    expect(sheet.textContent.split(CAUTION)).toHaveLength(2);
    // One external link per source, and the app fetches none of them.
    const links = within(sheet).getAllByRole('link');
    expect(links).toHaveLength(rows.length);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/wrencounty\.example\//u);
    }
    // A signed-in person can report a mistake from the sheet.
    fireEvent.click(within(sheet).getByTestId('office.sources-sheet-report'));
    expect(screen.getByTestId('office.report-sheet')).toBeTruthy();
  });

  it('a power opens its own source', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    const [power] = dataOf(fixtures.officeReady).office.powers;
    if (power === undefined) {
      throw new Error('the ready office has a power');
    }
    const row = screen.getByTestId(`office.power-${power.powerId}`);
    expect(nameOf(row)).toContain(power.name);
    expect(nameOf(row)).toContain(power.description);
    fireEvent.click(row);
    const sheet = screen.getByTestId('office.sources-sheet');
    expect(within(sheet).getByRole('heading', { name: power.name })).toBeTruthy();
  });

  it('tracks sheet', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    fireEvent.click(screen.getByTestId('office.steps-open'));
    const sheet = screen.getByTestId('office.steps-sheet');
    expect(within(sheet).getByRole('heading', { name: 'How to file' })).toBeTruthy();
    expect(within(sheet).getByRole('heading', { name: 'Nonpartisan' })).toBeTruthy();
    expect(within(sheet).getByText('Opens')).toBeTruthy();
    expect(within(sheet).getByText('Closes')).toBeTruthy();
    expect(sheet.textContent.split(CAUTION)).toHaveLength(2);
    // The track's source opens the sources sheet in this one's place.
    fireEvent.click(within(sheet).getByTestId('office.source-link-track-1'));
    expect(screen.getByTestId('office.sources-sheet')).toBeTruthy();

    // No election: no way to the steps.
    draw(fixtures.officeNoElection);
    expect(screen.queryByTestId('office.steps-open')).toBeNull();
  });

  it('field report', () => {
    setViewport(...COMPACT);
    const onSubmit = vi.fn();
    const onReset = vi.fn();
    draw(withReport(fixtures.officeReady, { onSubmit, onReset }));
    fireEvent.click(screen.getByTestId('office.report-open'));
    const sheet = screen.getByTestId('office.report-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Report a mistake' })).toBeTruthy();
    // Something else about the office, then the 24 fields.
    expect(within(sheet).getAllByRole('radio')).toHaveLength(25);

    const send = screen.getByTestId('office.report-send');
    expect(nameOf(send)).toBe('Add a note or a link');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(send);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('office.report-message'), {
      target: { value: '  The fee went up this year.  ' },
    });
    expect(nameOf(screen.getByTestId('office.report-send'))).toBe('Send');
    expect(screen.getByTestId('office.report-send').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(screen.getByTestId('office.report-send'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenLastCalledWith({
      field: null,
      message: 'The fee went up this year.',
      sourceUrl: null,
    });

    // A field and a link: the field goes by its stored name, and a link alone is enough.
    fireEvent.click(screen.getByTestId('office.report-field-filing_fee_cents'));
    fireEvent.change(screen.getByTestId('office.report-message'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('office.report-link'), {
      target: { value: 'https://wrencounty.example/fees' },
    });
    fireEvent.click(screen.getByTestId('office.report-send'));
    expect(onSubmit).toHaveBeenLastCalledWith({
      field: 'filing_fee_cents',
      message: null,
      sourceUrl: 'https://wrencounty.example/fees',
    });
    // The whole office is no field.
    fireEvent.click(screen.getByTestId('office.report-field-whole'));
    fireEvent.click(screen.getByTestId('office.report-send'));
    expect(onSubmit).toHaveBeenLastCalledWith({
      field: null,
      message: null,
      sourceUrl: 'https://wrencounty.example/fees',
    });

    // Closing puts the report back and drops what was typed.
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('office.report-sheet-grabber'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('field report states', () => {
    setViewport(...COMPACT);
    const onReset = vi.fn();
    draw(withReport(fixtures.officeReportSent, { onReset }));
    fireEvent.click(screen.getByTestId('office.report-open'));
    let sheet = screen.getByTestId('office.report-sheet');
    expect(sheet.textContent).toContain('Thanks. We check reports against official sources.');
    expect(screen.queryByTestId('office.report-send')).toBeNull();
    expect(nameOf(screen.getByTestId('office.report-close'))).toBe('Close');
    fireEvent.click(screen.getByTestId('office.report-close'));
    expect(onReset).toHaveBeenCalledTimes(1);

    draw(fixtures.officeReportLinkInvalid);
    fireEvent.click(screen.getByTestId('office.report-open'));
    sheet = screen.getByTestId('office.report-sheet');
    // The refusal of the link is said at the link's field, and nowhere else.
    const alerts = within(sheet).getAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual([english('errors:link_invalid')]);

    draw(fixtures.officeReportError);
    fireEvent.click(screen.getByTestId('office.report-open'));
    sheet = screen.getByTestId('office.report-sheet');
    expect(sheet.textContent).toContain(english('errors:account_too_new'));
    expect(sheet.textContent).not.toContain(english('errors:link_invalid'));

    draw(fixtures.officeReportSending);
    fireEvent.click(screen.getByTestId('office.report-open'));
    expect(screen.getByTestId('office.report-send').getAttribute('aria-busy')).toBe('true');
  });

  it('signed out has no report button', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeSignedOut);
    expect(screen.queryByTestId('office.report-open')).toBeNull();
    fireEvent.click(screen.getByTestId('office.sources-open-1'));
    expect(screen.queryByTestId('office.sources-sheet-report')).toBeNull();
  });

  it('a report waits for a connection', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeStale);
    const report = screen.getByTestId('office.report-open');
    expect(nameOf(report)).toBe('Needs a connection');
    expect(report.getAttribute('aria-disabled')).toBe('true');
    // The two actions are drawn as usual.
    expect(nameOf(screen.getByTestId('office.follow-button'))).toBe('Follow');
  });

  it('expanded layout', () => {
    setViewport(...EXPANDED);
    draw(fixtures.officeReady);
    const card = screen.getByTestId('office.action-card');
    // The stacked row is the page's only action row: no bar stands under the content.
    expect(screen.getAllByTestId('office.actions')).toHaveLength(1);
    expect(within(card).getByTestId('office.actions')).toBeTruthy();
    expect(within(card).getByTestId('office.follow-button')).toBeTruthy();
    expect(within(card).queryByTestId('office.run-button')).toBeNull();
    const days = within(card).getByTestId('office.action-card-days-live');
    expect(within(days).getByLabelText('12 days left to file').textContent).toBe('12');
    expect(days.textContent).toContain('Nov 27');
    for (const meter of ['office.action-card-ease', 'office.action-card-impact']) {
      expect(nameOf(within(card).getByTestId(meter)), meter).toMatch(/not known yet/iu);
    }

    // Where filing is not open the closing line stands alone.
    draw(fixtures.officeNoElection);
    expect(screen.queryByTestId('office.action-card-days-live')).toBeNull();
    expect(screen.getByTestId('office.action-card').textContent).not.toBe('');

    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    expect(screen.queryByTestId('office.action-card')).toBeNull();
    expect(screen.getAllByTestId('office.actions')).toHaveLength(1);
  });

  it('the hero is one image once it is measured', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    const hero = screen.getByTestId('office.hero');
    // Before its width is known it is a block of its least height, and no canvas.
    expect(hero.querySelector('svg')).toBeNull();
    expect(within(hero).getByRole('progressbar')).toBeTruthy();
    layOut(hero, COMPACT[0]);
    expect(hero.getAttribute('role')).toBe('img');
    expect(hero.getAttribute('aria-label')).toContain('County Treasurer');
    expect(hero.querySelector('svg')?.getAttribute('width')).toBe(String(COMPACT[0]));
    expect(within(hero).queryByRole('progressbar')).toBeNull();
  });

  it('the notices stand under the hero', () => {
    setViewport(...COMPACT);
    const onOpenSource = vi.fn();
    const data = dataOf(fixtures.officePlaceholder);
    draw({ status: 'ready', refreshing: false, stale: false, data: { ...data, onOpenSource } });
    expect(screen.getByTestId('office.notice-placeholder').textContent).toContain(
      'We know this office exists, but not its details yet.',
    );
    fireEvent.click(screen.getByTestId('office.notice-clerk'));
    expect(onOpenSource).toHaveBeenCalledWith(data.office.jurisdiction.website);

    draw(fixtures.officeRetired);
    expect(screen.getByTestId('office.notice-retired')).toBeTruthy();
    draw(fixtures.officeMinimal);
    expect(screen.getByTestId('office.notice-minimal').textContent).toContain(
      'Not known yet: pay, filing fee, and where to file.',
    );
    draw(fixtures.officeReady);
    expect(screen.queryByTestId(/^office\.notice-/u)).toBeNull();
  });

  it('a party seat filled at a caucus has no deadline', () => {
    setViewport(...COMPACT);
    draw(fixtures.officePartySelection);
    expect(screen.getByText('Filled at a party caucus, not by filing.')).toBeTruthy();
    expect(screen.queryByTestId('office.field-filingDeadline')).toBeNull();
    expect(screen.queryByTestId('office.deadline-live')).toBeNull();
    expect(screen.getByTestId('office.source-link-filing-1')).toBeTruthy();
  });

  it('single-issue mode makes the chips a choice', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeReady);
    expect(screen.getByTestId('office.issue-property-taxes').getAttribute('role')).not.toBe(
      'button',
    );
    const onSelect = vi.fn();
    const data = dataOf(fixtures.officeSingleIssue);
    draw({
      status: 'ready',
      refreshing: false,
      stale: false,
      data: { ...data, singleIssue: { issueId: 'property-taxes', onSelect } },
    });
    fireEvent.click(screen.getByTestId('office.issue-public-money'));
    expect(onSelect).toHaveBeenCalledWith('public-money');
  });

  it('not found', () => {
    setViewport(...COMPACT);
    draw(fixtures.officeNotFound);
    expect(
      screen.getByRole('heading', { level: 1, name: "We can't find that office." }),
    ).toBeTruthy();
    const home = screen.getByTestId('office.not-found-action');
    expect(home.getAttribute('role') ?? home.tagName.toLowerCase()).toMatch(/^(link|a)$/u);
    expect(home.getAttribute('href')).toBe('/');
    expect(nameOf(home)).toBe('See your offices');
    expect(screen.queryByTestId('office.actions')).toBeNull();
  });

  it('error and offline', () => {
    setViewport(...COMPACT);
    const onRetry = vi.fn();
    draw({ status: 'error', code: 'internal', onRetry });
    expect(screen.getByRole('heading', { level: 1, name: "This didn't load." })).toBeTruthy();
    expect(screen.getByTestId('office.screen').textContent).toContain(english('errors:internal'));
    fireEvent.click(screen.getByTestId('office.screen-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    draw({ status: 'offline', onRetry });
    expect(screen.getByRole('heading', { level: 1, name: 'No connection.' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('office.screen-retry'));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('loading', () => {
    for (const [width, height] of [COMPACT, EXPANDED]) {
      setViewport(width, height);
      draw(fixtures.officeLoading);
      const loading = screen.getByTestId('office.loading');
      // One busy bar to a screen reader, whatever the number of blocks.
      expect(within(loading).getAllByRole('progressbar')).toHaveLength(1);
      expect(screen.queryByTestId('office.follow-button')).toBeNull();
      expect(screen.queryByTestId('office.bookmark-button')).toBeNull();
      expect(screen.queryByTestId('office.hero')).toBeNull();
    }
    setViewport(...COMPACT);
  });
});
