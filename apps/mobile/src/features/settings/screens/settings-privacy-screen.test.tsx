import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
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
type Ready = Extract<SettingsPrivacyViewModel, { status: 'ready' }>;

const SENTENCE =
  'Public posts, comments and bios may be checked by an automated AI service run by Anthropic; direct messages never are.';
const OFF_NOTE = 'Your content is never sent to it; keyword checks still apply.';

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

/** A ready fixture with some of its data replaced. */
function withData(base: Ready, data: Partial<Ready['data']>): Ready {
  return { ...base, data: { ...base.data, ...data } };
}

/** The fixture's person with the AI answer set. */
function answered(aiScreening: Ready['data']['me']['consents']['aiScreening']): Ready {
  const { me } = fixtures.privacyM1.data;
  return withData(fixtures.privacyM1, {
    me: { ...me, consents: { ...me.consents, aiScreening } },
  });
}

describe('SettingsPrivacyScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(7);
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

  it('the AI switch', () => {
    const onSetAiScreening = vi.fn();
    const root = draw(withData(fixtures.privacyM1, { onSetAiScreening }));
    expect(root.textContent).toContain(
      'Your issues, your districts and your private runs are never shown on your profile.',
    );
    const control = screen.getByTestId('settings.privacy-ai');
    expect(
      screen.getByRole('switch', { name: /Let an automated service check my public posts/ }),
    ).toBe(control);
    // The sentence as written stands with the switch.
    expect(root.textContent).toContain(SENTENCE);
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(root.textContent).not.toContain(OFF_NOTE);

    // Turning it off asks the view-model; the switch stays until the answer is saved.
    fireEvent.click(control);
    expect(onSetAiScreening).toHaveBeenCalledTimes(1);
    expect(onSetAiScreening).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('settings.privacy-ai').getAttribute('aria-checked')).toBe('true');
  });

  it('off says what still applies, and turns on again', () => {
    for (const answer of ['declined', 'not_asked'] as const) {
      const onSetAiScreening = vi.fn();
      const base = answered(answer);
      const root = draw(withData(base, { onSetAiScreening }));
      const control = screen.getByTestId('settings.privacy-ai');
      expect(control.getAttribute('aria-checked'), answer).toBe('false');
      expect(root.textContent, answer).toContain(OFF_NOTE);
      fireEvent.click(control);
      expect(onSetAiScreening, answer).toHaveBeenLastCalledWith(true);
    }
  });

  it('a change on its way waits', () => {
    const onSetAiScreening = vi.fn();
    draw(withData(fixtures.privacySaving, { onSetAiScreening }));
    const control = screen.getByTestId('settings.privacy-ai');
    expect(control.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(control);
    expect(onSetAiScreening).not.toHaveBeenCalled();
  });

  it('a failed save says so', () => {
    cleanup();
    setViewport(390, 844);
    const view = renderWithProviders(
      <ToastHost>
        <SettingsPrivacyScreenView vm={fixtures.privacySaving} />
      </ToastHost>,
    );
    expect(screen.queryByTestId('toast')).toBeNull();
    act(() => {
      view.rerender(
        <ToastHost>
          <SettingsPrivacyScreenView vm={fixtures.privacySaveFailed} />
        </ToastHost>,
      );
    });
    expect(screen.getByTestId('toast').textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
    // The switch is where it was: the change was never shown as made.
    expect(screen.getByTestId('settings.privacy-ai').getAttribute('aria-checked')).toBe(
      String(fixtures.privacySaveFailed.data.me.consents.aiScreening === 'granted'),
    );
    expect(screen.getByTestId('settings.privacy-ai').getAttribute('aria-busy')).not.toBe('true');
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

    // Shown from the cache: the switch takes no press.
    const onSetAiScreening = vi.fn();
    draw(withData(fixtures.privacyStale, { onSetAiScreening }));
    const control = screen.getByTestId('settings.privacy-ai');
    expect(control.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(control);
    expect(onSetAiScreening).not.toHaveBeenCalled();
  });
});
