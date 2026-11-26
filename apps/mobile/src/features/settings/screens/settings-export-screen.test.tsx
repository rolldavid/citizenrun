import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { instantDateTime } from '@/features/settings/components/instant-text';
import * as fixtures from '@/features/settings/view-models/settings-export.fixtures';
import type { SettingsExportViewModel } from '@/features/settings/view-models/settings-export.types';
import { renderWithProviders, setViewport } from '@/test/render';

import { SettingsExportScreenView } from './settings-export-screen';

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

const FIXTURES: Readonly<Record<string, SettingsExportViewModel>> = fixtures;
type Ready = Extract<SettingsExportViewModel, { status: 'ready' }>;

// An hour after the fixtures' request: inside the day before another may be asked for.
const NOW = new Date('2027-01-15T13:00:00.000Z');

/** An instant as the screen writes it, where the test runs. */
function timeOf(iso: string): string {
  return instantDateTime(iso, 'en') ?? '';
}

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsExportViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(<SettingsExportScreenView vm={vm} />);
  return screen.getByTestId('settings.export');
}

/** A ready fixture with some of its data replaced. */
function withData(base: Ready, data: Partial<Ready['data']>): Ready {
  return { ...base, data: { ...base.data, ...data } };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SettingsExportScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(11);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Export your data']);
    }
  });

  it('each state', () => {
    // Nothing asked for yet: the sentence and the button.
    const onRequest = vi.fn();
    const none = draw(withData(fixtures.exportNone, { onRequest }));
    expect(none.textContent).toContain(
      'Get a copy of your profile, issues, follows, posts, comments, runs and messages as one file.',
    );
    expect(within(none).queryByRole('status')).toBeNull();
    expect(within(none).queryByRole('alert')).toBeNull();
    const request = screen.getByTestId('settings.export-request');
    expect(request.textContent).toBe('Request my data');
    fireEvent.click(request);
    expect(onRequest).toHaveBeenCalledTimes(1);

    // Being built: a notice, and a button that waits for the file.
    const waiting = vi.fn();
    const queued = draw(withData(fixtures.exportQueued, { onRequest: waiting }));
    expect(within(queued).getByRole('status').textContent).toBe(
      'We are building your file. This can take a few minutes. We will tell you in Activity.',
    );
    const building = screen.getByTestId('settings.export-request');
    expect(building.textContent).toBe('Building your file');
    expect(building.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(building);
    expect(waiting).not.toHaveBeenCalled();

    // Ready: how long it is kept, and the download.
    const onDownload = vi.fn();
    draw(withData(fixtures.exportReady, { onDownload }));
    expect(screen.getByTestId('settings.export-ready').textContent).toBe(
      `Ready until ${timeOf('2027-01-16T12:04:00.000Z')}`,
    );
    expect(screen.queryByTestId('settings.export-request')).toBeNull();
    const download = screen.getByTestId('settings.export-download');
    expect(download.textContent).toBe('Download');
    fireEvent.click(download);
    expect(onDownload).toHaveBeenCalledTimes(1);

    // Expired and failed say so, and another can be asked for.
    const expired = draw(fixtures.exportExpired);
    expect(within(expired).getByRole('status').textContent).toBe(
      'That file has expired. Request a new one.',
    );
    expect(screen.getByTestId('settings.export-request').textContent).toBe('Request my data');
    const failed = draw(fixtures.exportFailed);
    expect(within(failed).getByRole('alert').textContent).toBe(
      'We could not build your file. Try again.',
    );
    expect(screen.getByTestId('settings.export-request').getAttribute('aria-disabled')).not.toBe(
      'true',
    );

    // Inside the wait: no notice, and a button that says from when.
    const held = vi.fn();
    const wait = draw(withData(fixtures.exportWait, { onRequest: held }));
    expect(within(wait).queryByRole('alert')).toBeNull();
    const later = screen.getByTestId('settings.export-request');
    expect(later.textContent).toBe(`You can request again ${timeOf('2027-01-16T12:00:00.000Z')}`);
    expect(later.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(later);
    expect(held).not.toHaveBeenCalled();
  });

  it('a wait that is over lets the last file speak', () => {
    vi.setSystemTime(new Date('2027-01-16T12:00:01.000Z'));
    const root = draw(fixtures.exportWait);
    expect(within(root).getByRole('alert').textContent).toBe(
      'We could not build your file. Try again.',
    );
    expect(screen.getByTestId('settings.export-request').textContent).toBe('Request my data');
  });

  it('asking and fetching wait while they are on their way', () => {
    draw(withData(fixtures.exportNone, { requesting: true }));
    expect(screen.getByTestId('settings.export-request').getAttribute('aria-busy')).toBe('true');
    draw(withData(fixtures.exportReady, { downloading: true }));
    expect(screen.getByTestId('settings.export-download').getAttribute('aria-busy')).toBe('true');
  });

  it('a refusal is said above the button', () => {
    const coded = draw(withData(fixtures.exportNone, { errorCode: 'unavailable' }));
    expect(within(coded).getByRole('alert').textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
    const plain = draw(withData(fixtures.exportNone, { errorCode: 'generic' }));
    expect(within(plain).getByRole('alert').textContent).toBe('Something went wrong. Try again.');
  });

  it('the fresh sign-in', () => {
    draw(fixtures.exportNone);
    expect(screen.queryByTestId('auth.reauth-sheet')).toBeNull();
    draw(fixtures.exportReauth);
    expect(screen.getByTestId('auth.reauth-sheet')).not.toBeNull();
  });

  it('generic states', () => {
    const loading = draw(fixtures.exportLoading);
    expect(loading.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(screen.queryByTestId('settings.export-request')).toBeNull();

    const onRetry = vi.fn();
    draw({ ...fixtures.exportError, onRetry });
    fireEvent.click(screen.getByTestId('settings.export-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(draw(fixtures.exportOffline).textContent).toContain('No connection.');

    // Shown from the cache: nothing can be asked for, and the button says why.
    const onRequest = vi.fn();
    draw(withData(fixtures.exportStale, { onRequest }));
    const button = screen.getByTestId('settings.export-request');
    expect(button.textContent).toBe('Needs a connection');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onRequest).not.toHaveBeenCalled();
  });
});
