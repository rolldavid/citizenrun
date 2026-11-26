import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings-issues.fixtures';
import type { SettingsIssuesViewModel } from '@/features/settings/view-models/settings-issues.types';
import { renderWithProviders, setViewport } from '@/test/render';
import { ToastHost } from '@/ui/components/toast';

import { SettingsIssuesScreenView } from './settings-issues-screen';

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

const FIXTURES: Readonly<Record<string, SettingsIssuesViewModel>> = fixtures;
type Ready = Extract<SettingsIssuesViewModel, { status: 'ready' }>;

const SAVED = 'Issues saved. Your feed updates the next time it refreshes.';

function Framed({ vm }: { vm: SettingsIssuesViewModel }): React.JSX.Element {
  return (
    <ToastHost>
      <SettingsIssuesScreenView vm={vm} />
    </ToastHost>
  );
}

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsIssuesViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(<Framed vm={vm} />);
  return screen.getByTestId('settings.issues');
}

/** A ready fixture with some of its data replaced. */
function withData(base: Ready, data: Partial<Ready['data']>): Ready {
  return { ...base, data: { ...base.data, ...data } };
}

describe('SettingsIssuesScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(13);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      // The app bar's title is the screen's one heading: the step's own is not drawn.
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Your issues']);
    }
  });

  it('reuses the step', () => {
    const onContinue = vi.fn();
    const root = draw(withData(fixtures.settingsIssuesFive, { onContinue }));
    // The step's grid, under its own ids; the helper line; and Save in place of Continue.
    expect(root.querySelectorAll('[data-testid^="onboarding.issue-"]').length).toBeGreaterThan(0);
    expect(root.textContent).toContain('Pick 3 to 10. Star up to three.');
    const save = screen.getByTestId('settings.issues-save');
    expect(save.textContent).toBe('Save');
    // Sign-up's step bar is not part of this screen.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(root.textContent).not.toMatch(/Step \d of \d/);
    // The line that says the picks can be changed later belongs to sign-up.
    expect(root.textContent).not.toContain('You can change these later.');
    fireEvent.click(save);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0]?.[0]).toHaveLength(5);
  });

  it('a save on its way waits, and a refused one says why', () => {
    draw(fixtures.settingsIssuesSending);
    expect(screen.getByTestId('settings.issues-save').getAttribute('aria-busy')).toBe('true');
    const refused = draw(fixtures.settingsIssuesSubmitError);
    expect(within(refused).getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('saved then back', () => {
    const onBack = vi.fn();
    cleanup();
    setViewport(390, 844);
    const view = renderWithProviders(
      <Framed vm={withData(fixtures.settingsIssuesSending, { onBack })} />,
    );
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    act(() => {
      view.rerender(<Framed vm={withData(fixtures.settingsIssuesSaved, { onBack })} />);
    });
    expect(screen.getByTestId('toast').textContent).toBe(SAVED);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Drawn again with the same outcome, it neither says it nor leaves a second time.
    act(() => {
      view.rerender(<Framed vm={withData(fixtures.settingsIssuesSaved, { onBack })} />);
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a screen that opens saved says so and goes back', () => {
    const onBack = vi.fn();
    cleanup();
    setViewport(390, 844);
    // The app is already running when a person reaches the screen.
    const view = renderWithProviders(<ToastHost>{null}</ToastHost>);
    act(() => {
      view.rerender(
        <ToastHost>
          <SettingsIssuesScreenView vm={withData(fixtures.settingsIssuesSaved, { onBack })} />
        </ToastHost>,
      );
    });
    expect(screen.getByTestId('toast').textContent).toBe(SAVED);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('generic states', () => {
    const onRetry = vi.fn();
    draw({ ...fixtures.settingsIssuesError, onRetry });
    fireEvent.click(screen.getByTestId('settings.issues-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(draw(fixtures.settingsIssuesOffline).textContent).toContain('No connection.');
    expect(draw(fixtures.settingsIssuesLoading).textContent).not.toContain('{{');
  });
});
