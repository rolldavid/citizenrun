import { BRAND } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings-about.fixtures';
import type { SettingsAboutViewModel } from '@/features/settings/view-models/settings-about.types';
import { renderWithProviders, setViewport } from '@/test/render';

import { SettingsAboutScreenView } from './settings-about-screen';

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

const FIXTURES: Readonly<Record<string, SettingsAboutViewModel>> = fixtures;

const ROWS = ['settings.about-privacy', 'settings.about-terms', 'settings.about-content-policy'];

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsAboutViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(<SettingsAboutScreenView vm={vm} />);
  return screen.getByTestId('settings.about');
}

function rowIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-testid^="settings.about-"]')]
    .map((row) => row.getAttribute('data-testid') ?? '')
    .filter((id) => ROWS.includes(id));
}

describe('SettingsAboutScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(1);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
    }
  });

  it('one heading, the sentences, the links', () => {
    const onOpen = vi.fn();
    const root = draw({ ...fixtures.aboutM1, onOpen });

    // The page's own title is the screen's one heading: the app bar carries none.
    const headings = within(root).getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual([BRAND.displayName]);
    expect(
      within(root)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Policies and help']);
    expect(within(root).getByTestId('shell.app-bar-back')).not.toBeNull();

    // The sentence names the app as this build is named, which the catalog's own default supplies.
    expect(root.textContent).toContain(
      ' shows which offices you could run for, what each pays and decides, and how to file. It is free and takes no money from campaigns.',
    );
    // The sentence as written.
    expect(root.textContent).toContain(
      'This app is not affiliated with and does not represent any government or political entity.',
    );

    expect(rowIds(root)).toEqual(ROWS);
    expect(ROWS.map((id) => screen.getByTestId(id).textContent)).toEqual([
      'Privacy policy',
      'Terms',
      'Content policy',
    ]);
    // A row opens its page through the view-model; it is no link inside a link.
    for (const id of ROWS) {
      const row = screen.getByTestId(id);
      expect(row.querySelector('a'), id).toBeNull();
      expect(row.closest('a'), id).toBeNull();
    }
    const urls = Object.fromEntries(fixtures.aboutM1.links.map((link) => [link.id, link.url]));
    fireEvent.click(screen.getByTestId('settings.about-privacy'));
    expect(onOpen).toHaveBeenLastCalledWith(urls.privacy);
    fireEvent.click(screen.getByTestId('settings.about-terms'));
    expect(onOpen).toHaveBeenLastCalledWith(urls.terms);
    fireEvent.click(screen.getByTestId('settings.about-content-policy'));
    expect(onOpen).toHaveBeenLastCalledWith(urls.contentPolicy);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('a link with no row of its own is not drawn', () => {
    const root = draw({
      ...fixtures.aboutM1,
      links: [
        { id: 'terms', url: 'https://example.test/terms' },
        { id: 'credits', url: 'https://example.test/credits' },
      ],
    });
    expect(rowIds(root)).toEqual(['settings.about-terms']);
  });
});
