import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings-privacy.fixtures';
import type { SettingsPrivacyViewModel } from '@/features/settings/view-models/settings-privacy.types';
import { renderWithProviders, setViewport } from '@/test/render';
import { ToastHost } from '@/ui/components/toast';

import { SettingsPrivacyScreenView } from './settings-privacy-screen';

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

const FIXTURES: Readonly<Record<string, SettingsPrivacyViewModel>> = fixtures;

const INTRO = 'Your issues, your districts and your private runs are never shown on your profile.';

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsPrivacyViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(
    <ToastHost>
      <SettingsPrivacyScreenView vm={vm} />
    </ToastHost>,
  );
  return screen.getByTestId('settings.privacy');
}

describe('SettingsPrivacyScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(5);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Privacy']);
    }
  });

  it('says what a profile never shows, and asks nothing about AI screening', () => {
    for (const vm of [fixtures.privacyM1, fixtures.privacyStale]) {
      const root = draw(vm);
      expect(root.textContent).toContain(INTRO);
      // No switch, no box and no sentence about an automated check (D-900).
      expect(root.querySelectorAll('[role="switch"], [role="checkbox"], input')).toHaveLength(0);
      expect(screen.queryByTestId('settings.privacy-ai')).toBeNull();
      expect(root.textContent).not.toMatch(/\bAI\b|Anthropic|automated/i);
    }
  });

  it('generic states', () => {
    const loading = draw(fixtures.privacyLoading);
    expect(loading.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(within(loading).queryAllByRole('heading', { level: 2 })).toHaveLength(0);

    const onRetry = vi.fn();
    draw({ ...fixtures.privacyError, onRetry });
    fireEvent.click(screen.getByTestId('settings.privacy-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(draw(fixtures.privacyOffline).textContent).toContain('No connection.');
  });
});
