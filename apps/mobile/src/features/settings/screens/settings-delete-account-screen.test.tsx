import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings-delete-account.fixtures';
import type { SettingsDeleteViewModel } from '@/features/settings/view-models/settings-delete-account.types';
import { renderWithProviders, setViewport } from '@/test/render';
import { ToastHost } from '@/ui/components/toast';

import { SettingsDeleteAccountScreenView } from './settings-delete-account-screen';

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

const FIXTURES: Readonly<Record<string, SettingsDeleteViewModel>> = fixtures;
type Ready = Extract<SettingsDeleteViewModel, { status: 'ready' }>;

const PARAGRAPHS = [
  'Deleting your account removes your profile, posts, comments, follows, runs and messages.',
  'It finishes within 24 hours.',
  'It cannot be undone.',
  'The other person in each of your conversations loses the conversation too.',
];

const KEPT = [
  'Material we are legally required to preserve.',
  'Reports that were decided, with your name unlinked.',
  'Content under an open report, until it is decided and for 30 days at most.',
  'Records of moderation decisions.',
  'If the account was suspended, a keyed fingerprint of its sign-in, so it cannot sign up again.',
  'Encrypted backups for up to 27 days, and a keyed fingerprint of the account id in our recovery log for 35 days.',
];

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsDeleteViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(
    <ToastHost>
      <SettingsDeleteAccountScreenView vm={vm} />
    </ToastHost>,
  );
  return screen.getByTestId('settings.delete');
}

/** A ready fixture with some of its data replaced. */
function withData(base: Ready, data: Partial<Ready['data']>): Ready {
  return { ...base, data: { ...base.data, ...data } };
}

describe('SettingsDeleteAccountScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(11);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Delete account']);
    }
  });

  it('states every kept item', () => {
    const root = draw(fixtures.deleteInfo);
    let from = 0;
    // What is removed and when, then what is kept, in the order written.
    for (const sentence of [...PARAGRAPHS, 'What we keep', ...KEPT, 'Export your data first']) {
      const at = root.textContent.indexOf(sentence, from);
      expect(at, sentence).toBeGreaterThanOrEqual(from);
      from = at + sentence.length;
    }
    expect(within(root).getByRole('heading', { level: 2 }).textContent).toBe('What we keep');
    expect(
      within(root)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(KEPT);

    // The way to the export is a link of its own.
    const link = screen.getByTestId('settings.delete-export-first');
    expect(screen.getByRole('link', { name: 'Export your data first' })).toBe(link);
    expect(link.getAttribute('href')).toBe('/settings/export');

    expect(screen.queryByTestId('settings.delete-dialog')).toBeNull();
    expect(screen.queryByTestId('auth.reauth-sheet')).toBeNull();
  });

  it('confirm dialog', () => {
    // The button asks; it deletes nothing.
    const onAskDelete = vi.fn();
    const onConfirm = vi.fn();
    draw(withData(fixtures.deleteInfo, { onAskDelete, onConfirm }));
    const action = screen.getByTestId('settings.delete-action');
    expect(action.textContent).toBe('Delete my account');
    fireEvent.click(action);
    expect(onAskDelete).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    const onCancel = vi.fn();
    draw(withData(fixtures.deleteConfirm, { onConfirm, onCancel }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBe(screen.getByTestId('settings.delete-dialog'));
    expect(dialog.textContent).toContain('Delete your account?');
    expect(dialog.textContent).toContain(
      `@${fixtures.deleteConfirm.data.me.handle ?? ''} and everything in it will be removed within 24 hours. This cannot be undone.`,
    );
    // Cancel first, the destructive answer last, and never the one focus starts on.
    const answers = within(dialog).getAllByRole('button');
    expect(answers.map((answer) => answer.getAttribute('data-testid'))).toEqual([
      'settings.delete-cancel',
      'settings.delete-confirm',
    ]);
    expect(answers.map((answer) => answer.textContent)).toEqual(['Cancel', 'Delete account']);
    expect(document.activeElement).not.toBe(answers[1]);

    fireEvent.click(screen.getByTestId('settings.delete-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('settings.delete-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reauth, error, suspended', () => {
    // The fresh sign-in is asked alone: the question waits behind it.
    draw(fixtures.deleteReauth);
    expect(screen.getByTestId('auth.reauth-sheet')).not.toBeNull();
    expect(screen.queryByTestId('settings.delete-dialog')).toBeNull();

    // While the deletion is on its way the button waits.
    const onAskDelete = vi.fn();
    draw(withData(fixtures.deleteDeleting, { onAskDelete }));
    const waiting = screen.getByTestId('settings.delete-action');
    expect(waiting.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(waiting);
    expect(onAskDelete).not.toHaveBeenCalled();

    const failed = draw(fixtures.deleteError);
    expect(within(failed).getByRole('alert').textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
    expect(screen.getByTestId('settings.delete-action').getAttribute('aria-busy')).not.toBe('true');

    // A suspended account reads the same screen and can delete itself.
    const again = vi.fn();
    const suspended = draw(withData(fixtures.deleteSuspended, { onAskDelete: again }));
    for (const sentence of [...PARAGRAPHS, ...KEPT]) {
      expect(suspended.textContent, sentence).toContain(sentence);
    }
    fireEvent.click(screen.getByTestId('settings.delete-action'));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('deleted says so', () => {
    cleanup();
    setViewport(390, 844);
    const view = renderWithProviders(
      <ToastHost>
        <SettingsDeleteAccountScreenView vm={fixtures.deleteDeleting} />
      </ToastHost>,
    );
    expect(screen.queryByTestId('toast')).toBeNull();
    act(() => {
      view.rerender(
        <ToastHost>
          <SettingsDeleteAccountScreenView vm={fixtures.deleteDeleted} />
        </ToastHost>,
      );
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast').textContent).toBe('Your account is being deleted.');
    // Nothing more can be asked of an account that is going.
    const onAskDelete = vi.fn();
    draw(withData(fixtures.deleteDeleted, { onAskDelete }));
    fireEvent.click(screen.getByTestId('settings.delete-action'));
    expect(onAskDelete).not.toHaveBeenCalled();
  });

  it('generic states', () => {
    const loading = draw(fixtures.deleteLoading);
    expect(loading.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(screen.queryByTestId('settings.delete-action')).toBeNull();

    const onRetry = vi.fn();
    draw({ ...fixtures.deleteLoadError, onRetry });
    fireEvent.click(screen.getByTestId('settings.delete-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(draw(fixtures.deleteOffline).textContent).toContain('No connection.');

    // Shown from the cache: the account cannot be deleted, and the button says why.
    const onAskDelete = vi.fn();
    draw(withData(fixtures.deleteStale, { onAskDelete }));
    const button = screen.getByTestId('settings.delete-action');
    expect(button.textContent).toBe('Needs a connection');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onAskDelete).not.toHaveBeenCalled();
  });
});
