import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FIXTURE_ISSUES } from '@/features/onboarding/view-models/__fixtures__/issues';
import * as fixtures from '@/features/onboarding/view-models/issues.fixtures';
import type {
  OnboardingIssuesData,
  OnboardingIssuesViewModel,
} from '@/features/onboarding/view-models/issues.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';

import { IssuesStepView } from './issues-step-view';
import type { IssuesStepVm } from './issues-step-view';
import { OnboardingIssuesScreenView } from './onboarding-issues-screen';

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

// The layout the screen reads: the window's own, made tight when a case asks for it. The page
// never reports a text size above the default, so no window makes a layout tight by itself.
const layout = vi.hoisted(() => {
  const state: { isTight: boolean } = { isTight: false };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout => {
      const own = actual.useBreakpoint();
      return layout.isTight ? { ...own, isTight: true } : own;
    },
  };
});

const FIXTURES: Readonly<Record<string, OnboardingIssuesViewModel>> = fixtures;

type Picked = Parameters<OnboardingIssuesData['onContinue']>[0];

const SHORT_NAMES = [
  'Rent',
  'Utility bills',
  'Data centers',
  'Climate',
  'Corporate subsidies',
  'Property taxes',
  'Wages',
  'Policing',
  'Healthcare',
  'Medicare for All',
  'Schools',
  'Water and land',
  'Transit',
  'Voting access',
  'Money in politics',
  'Nominations',
  'Public money',
  'Defunding Israel',
  'Foreign wars',
];

const PRIVACY = 'Your issues are stored privately to rank your feed and are never shown publicly.';

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: OnboardingIssuesViewModel): HTMLElement {
  cleanup();
  renderWithProviders(<OnboardingIssuesScreenView vm={vm} />);
  return screen.getByTestId('onboarding.issues');
}

/** A ready fixture with some of its data replaced. */
function readyWith(
  vm: OnboardingIssuesViewModel,
  data: Partial<OnboardingIssuesData>,
): OnboardingIssuesViewModel {
  if (vm.status !== 'ready') {
    throw new Error('the fixture is not ready');
  }
  return { ...vm, data: { ...vm.data, ...data } };
}

function chip(issueId: string): HTMLElement {
  return screen.getByTestId(`onboarding.issue-${issueId}`);
}

function star(issueId: string): HTMLElement {
  return screen.getByTestId(`onboarding.issue-${issueId}-star`);
}

function isChecked(element: HTMLElement): boolean {
  return element.getAttribute('aria-checked') === 'true';
}

function continueButton(): HTMLElement {
  return screen.getByTestId('onboarding.issues-continue');
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

/** The chips of the grid, in the order they are drawn. */
function chips(): HTMLElement[] {
  const grid = screen.getByTestId('onboarding.issue');
  return within(grid)
    .getAllByRole('checkbox')
    .filter((each) => !(each.getAttribute('data-testid') ?? '').endsWith('-star'));
}

/** The name each chip prints, in the order the chips are drawn. */
function printedNames(): (string | null)[] {
  return [...screen.getByTestId('onboarding.issue').children]
    .flatMap((row) => [...row.children])
    .filter((cell) => cell.querySelector('[role="checkbox"]') !== null)
    .map((cell) => cell.textContent);
}

/** How many chips each row of the grid holds. */
function chipsPerRow(): number[] {
  const all = chips();
  return [...screen.getByTestId('onboarding.issue').children].map(
    (row) => all.filter((each) => row.contains(each)).length,
  );
}

describe('OnboardingIssuesScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(11);
    setViewport(390, 844);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      expect(
        screen.getAllByRole('heading', { level: 1 }).map((title) => title.textContent),
        name,
      ).toEqual(['What do you want to change?']);
      expect(screen.getByRole('progressbar', { name: 'Step 4 of 5' })).toBeTruthy();
      expect(within(root).getByText('Pick 3 to 10. Star up to three.')).toBeTruthy();
    }
  });

  it('renders at every window size', () => {
    for (const [width, height] of [
      [360, 740],
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const vm of [fixtures.issuesFive, fixtures.issuesLoading, fixtures.issuesError]) {
        draw(vm);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.queryByTestId('shell.rail')).toBeNull();
      }
    }
    setViewport(390, 844);
  });

  it('all 19 chips', () => {
    draw(fixtures.issuesNone);
    const all = chips();
    expect(all.map((each) => each.getAttribute('data-testid'))).toEqual(
      FIXTURE_ISSUES.map((issue) => `onboarding.issue-${issue.id}`),
    );
    // Named in full to a screen reader, printed short.
    expect(all.map((each) => each.getAttribute('aria-label'))).toEqual(
      FIXTURE_ISSUES.map((issue) => issue.name),
    );
    expect(printedNames()).toEqual(SHORT_NAMES);
    expect(all.filter(isChecked)).toEqual([]);
    expect(screen.getByRole('group', { name: 'What do you want to change?' })).toBe(
      screen.getByTestId('onboarding.issue'),
    );
    // Two to a row, the odd one out alone.
    expect(chipsPerRow()).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 1]);
  });

  it('an issue this build does not know shows its full name', () => {
    const issues = [
      ...FIXTURE_ISSUES,
      { id: 'fixture-new-issue', name: 'Fixture issue name', icon: 'fixture-new-issue', sort: 20 },
    ];
    draw(readyWith(fixtures.issuesNone, { issues }));
    expect(printedNames().at(-1)).toBe('Fixture issue name');
    expect(chips()).toHaveLength(20);
  });

  it('three to continue', () => {
    const onContinue = vi.fn<(picked: Picked) => void>();
    const root = draw(readyWith(fixtures.issuesTwo, { onContinue }));
    expect(within(root).getByText('2 picked, 0 starred')).toBeTruthy();
    expect(within(root).getByText('You can change these later.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick 3 or more' })).toBe(continueButton());
    expect(isDisabled(continueButton())).toBe(true);
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.click(chip('climate'));
    expect(within(root).getByText('3 picked, 0 starred')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBe(continueButton());
    expect(isDisabled(continueButton())).toBe(false);

    fireEvent.click(chip('climate'));
    expect(within(root).getByText('2 picked, 0 starred')).toBeTruthy();
    expect(isDisabled(continueButton())).toBe(true);
  });

  it('the count is announced', () => {
    const root = draw(fixtures.issuesFive);
    const line = within(root).getByText('5 picked, 2 starred');
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('the eleventh does nothing', () => {
    const root = draw(fixtures.issuesTen);
    expect(within(root).getByText('10 picked, 2 starred')).toBeTruthy();
    fireEvent.click(chip('schools'));
    expect(isChecked(chip('schools'))).toBe(false);
    expect(chips().filter(isChecked)).toHaveLength(10);
    expect(within(root).getByText('10 is the most')).toBeTruthy();
    expect(within(root).queryByText('10 picked, 2 starred')).toBeNull();
    // The next change brings the count back.
    fireEvent.click(chip('medicare-for-all'));
    expect(within(root).queryByText('10 is the most')).toBeNull();
    expect(within(root).getByText('9 picked, 2 starred')).toBeTruthy();
    fireEvent.click(chip('schools'));
    expect(isChecked(chip('schools'))).toBe(true);
    expect(within(root).getByText('10 picked, 2 starred')).toBeTruthy();
  });

  it('the fourth star', () => {
    const root = draw(fixtures.issuesStarLimit);
    expect(within(root).getByText('5 picked, 3 starred')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Star Property taxes' })).toBe(
      star('property-taxes'),
    );
    fireEvent.click(star('property-taxes'));
    expect(isChecked(star('property-taxes'))).toBe(false);
    expect(within(root).getByText('3 stars is the most')).toBeTruthy();
    // Letting a star go makes room for another.
    fireEvent.click(star('utility-bills'));
    expect(within(root).getByText('5 picked, 2 starred')).toBeTruthy();
    fireEvent.click(star('property-taxes'));
    expect(isChecked(star('property-taxes'))).toBe(true);
    expect(within(root).getByText('5 picked, 3 starred')).toBeTruthy();
  });

  it('a star shows on a picked chip only', () => {
    draw(fixtures.issuesFive);
    expect(isChecked(star('rent-housing'))).toBe(true);
    expect(isChecked(star('utility-bills'))).toBe(false);
    expect(screen.queryByTestId('onboarding.issue-climate-star')).toBeNull();
  });

  it('unpicking removes the star', () => {
    const onContinue = vi.fn<(picked: Picked) => void>();
    const root = draw(readyWith(fixtures.issuesFive, { onContinue }));
    fireEvent.click(chip('rent-housing'));
    expect(within(root).getByText('4 picked, 1 starred')).toBeTruthy();
    // Picked again, it comes back without its star.
    fireEvent.click(chip('rent-housing'));
    expect(within(root).getByText('5 picked, 1 starred')).toBeTruthy();
    expect(isChecked(star('rent-housing'))).toBe(false);
    fireEvent.click(continueButton());
    expect(onContinue.mock.calls).toEqual([
      [
        [
          { issueId: 'rent-housing', starred: false },
          { issueId: 'utility-bills', starred: false },
          { issueId: 'property-taxes', starred: false },
          { issueId: 'wages-workers', starred: false },
          { issueId: 'schools', starred: true },
        ],
      ],
    ]);
  });

  it('continue sends sort order', () => {
    const onContinue = vi.fn<(picked: Picked) => void>();
    draw(readyWith(fixtures.issuesNone, { onContinue }));
    for (const issueId of ['transit', 'climate', 'foreign-wars', 'rent-housing']) {
      fireEvent.click(chip(issueId));
    }
    fireEvent.click(star('foreign-wars'));
    fireEvent.click(star('climate'));
    fireEvent.click(continueButton());
    expect(onContinue.mock.calls).toEqual([
      [
        [
          { issueId: 'rent-housing', starred: false },
          { issueId: 'climate', starred: true },
          { issueId: 'transit', starred: false },
          { issueId: 'foreign-wars', starred: true },
        ],
      ],
    ]);
  });

  it('sending makes continue busy', () => {
    const onContinue = vi.fn<(picked: Picked) => void>();
    draw(readyWith(fixtures.issuesSending, { onContinue }));
    expect(continueButton().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('a refused save says why and keeps the picks', () => {
    const root = draw(fixtures.issuesSubmitError);
    expect(screen.getByRole('alert').textContent).toBe(
      "One of those issues isn't available anymore. Choose again.",
    );
    expect(within(root).getByText('5 picked, 2 starred')).toBeTruthy();
    expect(isDisabled(continueButton())).toBe(false);
  });

  it('one column when tight', () => {
    layout.isTight = true;
    try {
      const root = draw(fixtures.issuesTight);
      expect(chipsPerRow()).toEqual(Array.from({ length: 19 }, () => 1));
      expect(within(root).getByText('5 picked, 2 starred')).toBeTruthy();
      // The footer keeps its count and gives up its helper.
      expect(within(root).queryByText('You can change these later.')).toBeNull();
      const tight = screen.getByRole('heading', { level: 1 }).style.fontSize;
      layout.isTight = false;
      draw(fixtures.issuesTight);
      const wide = screen.getByRole('heading', { level: 1 }).style.fontSize;
      expect(Number.parseFloat(tight)).toBeLessThan(Number.parseFloat(wide));
    } finally {
      layout.isTight = false;
    }
  });

  it('loading, error and offline', () => {
    const loading = draw(fixtures.issuesLoading);
    expect(screen.getAllByRole('progressbar', { name: 'Loading' })).toHaveLength(1);
    expect(screen.queryByTestId('onboarding.issue')).toBeNull();
    expect(screen.queryByTestId('shell.app-bar-back')).toBeNull();
    expect(within(loading).queryByText(PRIVACY)).toBeNull();
    expect(isDisabled(continueButton())).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));

    const onRetry = vi.fn<() => void>();
    const failed = draw({ ...fixtures.issuesError, onRetry });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe("This didn't load.");
    expect(
      within(failed).getByText("This isn't available right now. Try again in a few minutes."),
    ).toBeTruthy();
    expect(screen.queryByTestId('onboarding.issues-continue')).toBeNull();
    fireEvent.click(screen.getByTestId('onboarding.issues-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const again = vi.fn<() => void>();
    const offline = draw({ ...fixtures.issuesOffline, onRetry: again });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('No connection.');
    expect(
      within(offline).getByText('This screen needs a connection the first time.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('onboarding.issues-continue')).toBeNull();
    fireEvent.click(screen.getByTestId('onboarding.issues-retry'));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('the issues arriving take the saved picks once', () => {
    cleanup();
    const { rerender } = renderWithProviders(
      <OnboardingIssuesScreenView vm={fixtures.issuesLoading} />,
    );
    const root = screen.getByTestId('onboarding.issues');
    const heading = screen.getByRole('heading', { level: 1 });
    rerender(<OnboardingIssuesScreenView vm={fixtures.issuesFive} />);
    expect(within(root).getByText('5 picked, 2 starred')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
    fireEvent.click(chip('climate'));
    // A later answer from the server does not undo what the person picked since.
    rerender(<OnboardingIssuesScreenView vm={fixtures.issuesSending} />);
    expect(within(root).getByText('6 picked, 2 starred')).toBeTruthy();
    expect(isChecked(chip('climate'))).toBe(true);
  });

  it('without a connection the picks wait', () => {
    if (fixtures.issuesFive.status !== 'ready') {
      throw new Error('the fixture is not ready');
    }
    const onContinue = vi.fn<(picked: Picked) => void>();
    const root = draw({
      ...fixtures.issuesFive,
      stale: true,
      data: { ...fixtures.issuesFive.data, onContinue },
    });
    expect(within(root).getByText('No connection. This may be out of date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs a connection' })).toBe(continueButton());
    expect(isDisabled(continueButton())).toBe(true);
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('the privacy line', () => {
    const root = draw(fixtures.issuesNone);
    const line = within(root).getByText(PRIVACY);
    const grid = screen.getByTestId('onboarding.issue');
    expect(grid.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(grid.contains(line)).toBe(false);
  });

  it('back comes with the issues', () => {
    const onBack = vi.fn<() => void>();
    draw(readyWith(fixtures.issuesFive, { onBack }));
    fireEvent.click(screen.getByTestId('shell.app-bar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('IssuesStepView', () => {
  const READY: IssuesStepVm = fixtures.issuesFive;

  function drawStep(
    vm: IssuesStepVm,
    heading: string | null,
    showChangeLater: boolean,
  ): HTMLElement {
    cleanup();
    renderWithProviders(
      <IssuesStepView
        vm={vm}
        appBar={{ variant: 'screen', title: 'Fixture title', onBack: null }}
        heading={heading}
        groupLabel="Fixture group"
        helper="Fixture helper"
        primaryLabel="Fixture save"
        showChangeLater={showChangeLater}
        testIDs={{ screen: 'probe.issues', primary: 'probe.issues-save', grid: 'probe.issue' }}
      />,
    );
    return screen.getByTestId('probe.issues');
  }

  it('draws under another screen with its own names and ids', () => {
    const root = drawStep(READY, null, false);
    // The app bar's title is the one heading.
    expect(screen.getAllByRole('heading', { level: 1 }).map((title) => title.textContent)).toEqual([
      'Fixture title',
    ]);
    expect(screen.getByRole('group', { name: 'Fixture group' })).toBe(
      screen.getByTestId('probe.issue'),
    );
    expect(within(root).getByText('Fixture helper')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fixture save' })).toBe(
      screen.getByTestId('probe.issues-save'),
    );
    expect(isChecked(screen.getByTestId('probe.issue-rent-housing'))).toBe(true);
    expect(screen.getByTestId('probe.issue-rent-housing-star')).toBeTruthy();
    expect(within(root).getByText('5 picked, 2 starred')).toBeTruthy();
    expect(within(root).queryByText('You can change these later.')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('takes a save that has finished', () => {
    if (READY.status !== 'ready') {
      throw new Error('the fixture is not ready');
    }
    const saved: IssuesStepVm = {
      ...READY,
      data: { ...READY.data, submit: { status: 'saved', errorCode: null } },
    };
    drawStep(saved, 'Fixture heading', true);
    const save = screen.getByTestId('probe.issues-save');
    expect(save.getAttribute('aria-busy')).not.toBe('true');
    expect(isDisabled(save)).toBe(false);
    expect(screen.getAllByRole('heading', { level: 1 }).map((title) => title.textContent)).toEqual([
      'Fixture title',
      'Fixture heading',
    ]);
  });
});
