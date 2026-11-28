import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/profile/view-models/person.fixtures';
import type { PersonReadyData, PersonViewModel } from '@/features/profile/view-models/person.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { PersonScreenView } from './person-screen';

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

const FIXTURES: Readonly<Record<string, PersonViewModel>> = fixtures;
const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: PersonViewModel, options: RenderWithProvidersOptions = {}): void {
  cleanup();
  renderWithProviders(<PersonScreenView vm={vm} />, options);
}

function dataOf(vm: PersonViewModel): PersonReadyData {
  if (vm.status !== 'ready') {
    throw new Error('the fixture is not a ready state');
  }
  return vm.data;
}

/** What a screen reader calls an element: its label, or the words in it. */
function nameOf(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent).trim();
}

/** Every control the page draws. */
function controls(): HTMLElement[] {
  return [
    ...screen.queryAllByRole('button'),
    ...screen.queryAllByRole('link'),
    ...screen.queryAllByRole('textbox'),
  ];
}

describe('PersonScreenView', () => {
  /** Draws every fixture at one window size and checks what holds for each of them. */
  function drawsEveryFixture(viewport: readonly [number, number], theme: 'light' | 'dark'): void {
    setViewport(...viewport);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      draw(vm, { theme });
      const root =
        vm.status === 'loading'
          ? screen.getByTestId('person.loading')
          : screen.getByTestId('person.screen');
      expect(root.textContent, name).not.toContain('{{');
      expect(root.textContent, name).not.toContain('profile:');
      expect(root.textContent, name).not.toContain('errors:');
      // Every control has a role, a name and an id a test can find it by.
      for (const control of controls()) {
        expect(nameOf(control), name).not.toBe('');
        expect(control.getAttribute('data-testid') ?? '', `${name}: ${nameOf(control)}`).not.toBe(
          '',
        );
      }
      // One level 1 heading: the app bar's title, or the sentence of a full-screen state.
      expect(screen.queryAllByRole('heading', { level: 1 }), name).toHaveLength(
        vm.status === 'loading' ? 0 : 1,
      );
      if (vm.status === 'ready') {
        expect(
          screen.getByRole('heading', { level: 1, name: vm.data.person.name }),
          name,
        ).toBeTruthy();
        expect(screen.getByTestId('person.header'), name).toBeTruthy();
        // One row for each seat, in the order sent.
        expect(
          screen.getAllByTestId(/^person\.seat-/u).map((row) => row.getAttribute('data-testid')),
          name,
        ).toEqual(vm.data.seats.map((each) => `person.seat-${each.seat.office.slug}`));
      }
    }
    setViewport(...COMPACT);
  }

  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(13);
    drawsEveryFixture(COMPACT, 'light');
  });

  it('renders every fixture in the wide column', () => {
    drawsEveryFixture(EXPANDED, 'dark');
  });

  it('minimal page only', () => {
    setViewport(...COMPACT);
    draw(fixtures.personOfficeholder);
    const header = screen.getByTestId('person.header');
    expect(within(header).getByRole('heading', { name: 'Carol Wynn' })).toBeTruthy();
    expect(within(header).getByText('County Treasurer, Fixture Wren County')).toBeTruthy();
    expect(within(header).getByText('Democratic')).toBeTruthy();
    // No photo is the normal case: the initials stand in the header.
    expect(within(header).getByText('CW')).toBeTruthy();
    expect(within(header).queryByRole('img')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      'Carol Wynn',
      'Offices held',
    ]);
    expect(screen.getAllByTestId(/^person\.seat-/u).map((row) => nameOf(row))).toEqual([
      'County Treasurer. Since 2019',
      'Deputy Treasurer. Until 2018',
    ]);
    // The website is the header's one link, shown as its domain.
    const website = screen.getByTestId('person.header-link');
    expect(website.textContent).toBe('carolwynn.example');
    expect(nameOf(website)).toBe('carolwynn.example, opens in your browser');
    expect(website.getAttribute('href')).toBe('https://carolwynn.example');
    // The back button, the website and the two seats: nothing else can be pressed.
    expect(controls()).toHaveLength(4);
    for (const name of ['Follow', 'Claim this profile', 'Donate', 'Volunteer', "I'll help"]) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
      expect(screen.queryByRole('link', { name }), name).toBeNull();
      expect(screen.queryByText(name), name).toBeNull();
    }
    expect(screen.queryByText(/follower/iu)).toBeNull();
    expect(screen.queryByTestId('person.notice-retired')).toBeNull();
    expect(screen.queryByText('Created from public filings')).toBeNull();
  });

  it('party only where the view-model says so', () => {
    setViewport(...COMPACT);
    draw(fixtures.personNoPhoto);
    expect(dataOf(fixtures.personNoPhoto).person.party).toBe('democratic');
    expect(screen.queryByText('Democratic')).toBeNull();
    expect(screen.queryByTestId('person.header-link')).toBeNull();
  });

  it('photo and its credit', () => {
    setViewport(...COMPACT);
    draw(fixtures.personPhotoCredit);
    const header = screen.getByTestId('person.header');
    expect(within(header).getByText('Photo: Fixture Photographer, CC-BY-4.0.')).toBeTruthy();
    draw(fixtures.personOfficeholder);
    expect(screen.queryByText(/^Photo/u)).toBeNull();
  });

  it('created from public filings', () => {
    setViewport(...COMPACT);
    draw(fixtures.personFromFilings);
    expect(
      within(screen.getByTestId('person.header')).getByText('Created from public filings'),
    ).toBeTruthy();
  });

  it('retired', () => {
    setViewport(...COMPACT);
    draw(fixtures.personRetired);
    expect(screen.getByTestId('person.notice-retired').textContent).toContain(
      'This profile is no longer listed.',
    );
    // The seats are still listed, each with the year it ended.
    expect(screen.getAllByTestId(/^person\.seat-/u).map((row) => nameOf(row))).toEqual([
      'County Treasurer. Until 2026',
      'Deputy Treasurer. Until 2018',
    ]);
  });

  it('nothing known', () => {
    setViewport(...COMPACT);
    draw(fixtures.personAllUnknown);
    expect(nameOf(screen.getByTestId('person.seat-county-treasurer-wren'))).toBe(
      'County Treasurer. Start year not known yet',
    );
    expect(screen.queryByText('Democratic')).toBeNull();
    expect(screen.queryByTestId('person.header-link')).toBeNull();

    const data = dataOf(fixtures.personAllUnknown);
    draw({
      status: 'ready',
      refreshing: false,
      stale: false,
      data: { ...data, person: { ...data.person, seats: [] }, seats: [] },
    });
    expect(screen.getByText('Offices held are not known yet.')).toBeTruthy();
    expect(screen.queryAllByTestId(/^person\.seat-/u)).toEqual([]);
  });

  it('rows link to offices', () => {
    setViewport(...COMPACT);
    draw(fixtures.personOfficeholder);
    for (const slug of ['county-treasurer-wren', 'deputy-treasurer-wren']) {
      const row = screen.getByTestId(`person.seat-${slug}`);
      expect(row.getAttribute('role') ?? row.tagName.toLowerCase(), slug).toMatch(/^(link|a)$/u);
      expect(screen.getAllByRole('link'), slug).toContain(row);
      expect(row.getAttribute('href'), slug).toBe(`/office/${slug}`);
    }
  });

  it('stale shows the offline line over the page', () => {
    setViewport(...COMPACT);
    draw(fixtures.personStale);
    expect(screen.getByText('No connection. This may be out of date.')).toBeTruthy();
    expect(screen.getByTestId('person.header')).toBeTruthy();
    draw(fixtures.personOfficeholder);
    expect(screen.queryByText('No connection. This may be out of date.')).toBeNull();
  });

  it('not found', () => {
    setViewport(...COMPACT);
    draw(fixtures.personNotFound);
    expect(
      screen.getByRole('heading', { level: 1, name: "We can't find that profile." }),
    ).toBeTruthy();
    const action = screen.getByTestId('person.not-found-action');
    expect(nameOf(action)).toBe('See your offices');
    expect(screen.getAllByRole('link')).toContain(action);
    expect(action.getAttribute('href')).toBe('/');
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('error and offline offer another try', () => {
    setViewport(...COMPACT);
    const onRetry = vi.fn();
    draw({ status: 'error', code: 'internal', onRetry });
    expect(screen.getByRole('heading', { level: 1, name: "This didn't load." })).toBeTruthy();
    fireEvent.click(screen.getByTestId('person.screen-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    draw({ status: 'offline', onRetry });
    expect(screen.getByRole('heading', { level: 1, name: 'No connection.' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('person.screen-retry'));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('loading draws no words of a person', () => {
    setViewport(...COMPACT);
    draw(fixtures.personLoading);
    const root = screen.getByTestId('person.loading');
    expect(within(root).queryByRole('heading')).toBeNull();
    expect(screen.queryByTestId('person.header')).toBeNull();
    // One busy indicator is announced; the other blocks are out of a screen reader's way.
    expect(within(root).getAllByRole('progressbar')).toHaveLength(1);
  });
});
