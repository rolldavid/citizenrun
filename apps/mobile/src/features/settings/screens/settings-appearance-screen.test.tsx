import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings-appearance.fixtures';
import type { SettingsAppearanceViewModel } from '@/features/settings/view-models/settings-appearance.types';
import { renderWithProviders, setViewport } from '@/test/render';

import { SettingsAppearanceScreenView } from './settings-appearance-screen';

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

const FIXTURES: Readonly<Record<string, SettingsAppearanceViewModel>> = fixtures;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsAppearanceViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(<SettingsAppearanceScreenView vm={vm} />);
  return screen.getByTestId('settings.appearance-screen');
}

/** The choice the group shows as made. */
function chosen(): string[] {
  return screen
    .getAllByRole('radio')
    .filter((option) => option.getAttribute('aria-checked') === 'true')
    .map((option) => option.getAttribute('data-testid') ?? '');
}

describe('SettingsAppearanceScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(2);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Appearance']);
    }
  });

  it('three choices', () => {
    draw(fixtures.appearanceSystem);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBe(
      screen.getByTestId('settings.appearance'),
    );
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      'Match my device',
      'Light',
      'Dark',
    ]);
    expect(chosen()).toEqual(['settings.appearance-system']);

    draw(fixtures.appearanceDark);
    expect(chosen()).toEqual(['settings.appearance-dark']);
  });

  it('a choice goes to the view-model, which alone moves the mark', () => {
    const onChange = vi.fn();
    draw({ ...fixtures.appearanceSystem, onChange });
    fireEvent.click(screen.getByTestId('settings.appearance-dark'));
    expect(onChange).toHaveBeenLastCalledWith('dark');
    fireEvent.click(screen.getByTestId('settings.appearance-light'));
    expect(onChange).toHaveBeenLastCalledWith('light');
    expect(onChange).toHaveBeenCalledTimes(2);
    // The mark stays on the saved choice until the view-model says otherwise.
    expect(chosen()).toEqual(['settings.appearance-system']);
  });
});
