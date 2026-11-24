import { BRAND } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/hello/view-models/hello.fixtures';
import type { HelloViewModel } from '@/features/hello/view-models/hello.types';
import { getI18n } from '@/lib/i18n';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { space } from '@/ui/tokens';

import { HelloScreenView } from './hello-screen';

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
// The wordmark and the chair load no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('the wordmark and the chair load no asset');
  },
}));

type HelloReady = Extract<HelloViewModel, { status: 'ready' }>;

const FIXTURES = {
  helloLoading: fixtures.helloLoading,
  helloReady: fixtures.helloReady,
  helloWorkerStale: fixtures.helloWorkerStale,
  helloRefreshing: fixtures.helloRefreshing,
  helloStale: fixtures.helloStale,
  helloError: fixtures.helloError,
  helloOffline: fixtures.helloOffline,
} satisfies Record<string, HelloViewModel>;
const DRAWN: readonly HelloViewModel[] = Object.values(FIXTURES);

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const OFFLINE_LINE = 'No connection. This may be out of date.';
const STALE_WORKER = 'Not seen in the last 5 minutes';

type Viewport = readonly [width: number, height: number];

function sized(viewport: Viewport): void {
  setViewport(viewport[0], viewport[1]);
}

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: HelloViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<HelloScreenView vm={vm} />, options);
  return screen.getByTestId('hello.screen');
}

/** A ready view-model that counts the times it is asked again. */
function readyWith(patch: Partial<HelloReady> = {}): { vm: HelloReady; onRefresh: () => void } {
  const onRefresh = vi.fn<() => void>();
  return {
    vm: { ...fixtures.helloReady, data: { worker: 'running', onRefresh }, ...patch },
    onRefresh,
  };
}

function press(testID: string): void {
  fireEvent.click(screen.getByTestId(testID));
}

function textOf(testID: string): string | null {
  return screen.getByTestId(testID).textContent;
}

/** The level 1 headings a screen reader finds. */
function titles(): HTMLElement[] {
  return screen.queryAllByRole('heading', { level: 1 });
}

/** The box the screen's content stands in: the one that keeps its room above the first line. */
function contentBox(): HTMLElement {
  const box = screen.getByTestId('hello.title').parentElement;
  if (box === null) {
    throw new Error('the title has no box');
  }
  return box;
}

describe('HelloScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(FIXTURES).sort());
    for (const viewport of [NARROW, COMPACT, MEDIUM, EXPANDED]) {
      sized(viewport);
      for (const vm of DRAWN) {
        for (const theme of ['light', 'dark'] as const) {
          const root = draw(vm, { theme });
          expect(root.textContent).not.toContain('{{');
          expect(screen.getAllByRole('main')).toHaveLength(1);
          for (const marked of root.querySelectorAll('[data-testid]')) {
            expect(marked.getAttribute('data-testid')).toMatch(TEST_ID);
          }
        }
      }
    }
  });

  it('ready names the three checks', () => {
    sized(COMPACT);
    draw(fixtures.helloReady);
    const title = screen.getByTestId('hello.title');
    expect(titles()).toEqual([title]);
    expect(title.textContent).toBe(getI18n().t('hello:title'));
    expect(title.textContent).toMatch(/ is running\.$/);
    expect(textOf('hello.status-server')).toBe('Answering');
    expect(textOf('hello.status-database')).toBe('Ready');
    expect(textOf('hello.status-worker')).toBe('Running');
    // Each value stands in a row with what was asked.
    for (const [testID, label] of [
      ['hello.status-server', 'Server'],
      ['hello.status-database', 'Database'],
      ['hello.status-worker', 'Background jobs'],
    ] as const) {
      const row = screen.getByTestId(testID).parentElement?.parentElement;
      expect(row?.textContent).toBe(`${label}${textOf(testID) ?? ''}`);
    }
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Status');
  });

  it('the title takes the focus when the ready screen is drawn', () => {
    sized(COMPACT);
    draw(fixtures.helloReady);
    expect(document.activeElement).toBe(screen.getByTestId('hello.title'));
  });

  it('a stale worker is said once', () => {
    sized(COMPACT);
    const root = draw(fixtures.helloWorkerStale);
    expect(textOf('hello.status-worker')).toBe(STALE_WORKER);
    expect(screen.getAllByText(STALE_WORKER)).toHaveLength(1);
    expect(root.textContent.split(STALE_WORKER)).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The two other checks still passed.
    expect(textOf('hello.status-server')).toBe('Answering');
    expect(textOf('hello.status-database')).toBe('Ready');
  });

  it('Check again asks again', () => {
    sized(COMPACT);
    const idle = readyWith();
    draw(idle.vm);
    const button = screen.getByTestId('hello.refresh');
    expect(button.textContent).toBe('Check again');
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    press('hello.refresh');
    expect(idle.onRefresh).toHaveBeenCalledTimes(1);

    draw(fixtures.helloRefreshing);
    expect(screen.getByTestId('hello.refresh').getAttribute('aria-busy')).toBe('true');
    // A press while it waits asks nothing more.
    const waiting = readyWith({ refreshing: true });
    draw(waiting.vm);
    press('hello.refresh');
    expect(waiting.onRefresh).not.toHaveBeenCalled();
    // The three values stay while it asks.
    expect(textOf('hello.status-server')).toBe('Answering');
  });

  it('stale shows the offline line and keeps Check again', () => {
    sized(COMPACT);
    draw(fixtures.helloStale);
    expect(screen.getByRole('status').textContent).toContain(OFFLINE_LINE);
    expect(screen.getAllByText(OFFLINE_LINE)).toHaveLength(1);

    const stale = readyWith({ stale: true });
    draw(stale.vm);
    const button = screen.getByTestId('hello.refresh');
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    press('hello.refresh');
    expect(stale.onRefresh).toHaveBeenCalledTimes(1);
    // The line's own way to try again asks the same thing.
    press('hello.screen-offline-retry');
    expect(stale.onRefresh).toHaveBeenCalledTimes(2);
    // The last answer stays on screen.
    expect(textOf('hello.status-server')).toBe('Answering');

    draw(fixtures.helloReady);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('error and offline are full-screen states with a level 1 title', () => {
    sized(COMPACT);
    const onRetry = vi.fn<() => void>();
    draw({ status: 'error', code: 'unavailable', onRetry });
    expect(titles().map((title) => title.textContent)).toEqual([getI18n().t('errors:unavailable')]);
    expect(titles()[0]?.textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
    expect(textOf('hello.retry')).toBe('Try again');
    press('hello.retry');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('hello.title')).toBeNull();
    expect(screen.queryByTestId('hello.refresh')).toBeNull();
    expect(document.activeElement).toBe(titles()[0]);

    const onRetryOffline = vi.fn<() => void>();
    const root = draw({ status: 'offline', onRetry: onRetryOffline });
    expect(titles().map((title) => title.textContent)).toEqual(['No connection.']);
    expect(within(root).getByText('This screen needs a connection the first time.')).toBeTruthy();
    expect(textOf('hello.retry')).toBe('Try again');
    press('hello.retry');
    expect(onRetryOffline).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('hello.refresh')).toBeNull();
    // The line of a stale screen belongs to a screen that has something to show.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('error names the code it is given', () => {
    sized(COMPACT);
    draw({ status: 'error', code: 'rate_limited', onRetry: () => undefined });
    expect(titles().map((title) => title.textContent)).toEqual([
      getI18n().t('errors:rate_limited'),
    ]);
  });

  it('loading is one progressbar named Loading', () => {
    sized(COMPACT);
    const root = draw(fixtures.helloLoading);
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.getAttribute('aria-label')).toBe('Loading');
    expect(bars[0]?.getAttribute('aria-busy')).toBe('true');
    // The other blocks pulse with it, out of a screen reader's way.
    const drawn = [...root.querySelectorAll('[role="progressbar"]')];
    expect(drawn).toHaveLength(6);
    expect(drawn.filter((block) => block.closest('[aria-hidden="true"]') === null)).toEqual(bars);
    expect(titles()).toEqual([]);
    expect(screen.queryByTestId('hello.refresh')).toBeNull();
    expect(root.textContent).toBe('');
  });

  it('the home bar shows at compact only', () => {
    sized(COMPACT);
    let root = draw(fixtures.helloReady);
    expect(within(root).getByRole('img', { name: BRAND.displayName })).toBeTruthy();
    expect(screen.queryByTestId('shell.app-bar-messages')).toBeNull();
    for (const viewport of [MEDIUM, EXPANDED]) {
      sized(viewport);
      root = draw(fixtures.helloReady);
      expect(within(root).queryByRole('img', { name: BRAND.displayName })).toBeNull();
      expect(screen.queryByTestId('shell.app-bar-messages')).toBeNull();
    }
  });

  it('the home bar shows in every state at compact', () => {
    sized(COMPACT);
    for (const vm of DRAWN) {
      const root = draw(vm);
      expect(within(root).getByRole('img', { name: BRAND.displayName })).toBeTruthy();
    }
  });

  it('leaves more room above the content at medium and expanded', () => {
    sized(COMPACT);
    draw(fixtures.helloReady);
    expect(contentBox().style.paddingTop).toBe(`${String(space.x6)}px`);
    for (const viewport of [MEDIUM, EXPANDED]) {
      sized(viewport);
      draw(fixtures.helloReady);
      expect(contentBox().style.paddingTop).toBe(`${String(space.x8)}px`);
    }
  });

  it('an empty state brings its own room, and the screen adds none above it', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      sized(viewport);
      for (const vm of [fixtures.helloError, fixtures.helloOffline]) {
        const root = draw(vm);
        const title = within(root).getByRole('heading', { level: 1 });
        // From the title up to the screen, one box has room above it: the empty state's own.
        const rooms: string[] = [];
        for (let box = title.parentElement; box !== null && box !== root; box = box.parentElement) {
          if (box.style.paddingTop !== '' && box.style.paddingTop !== '0px') {
            rooms.push(box.style.paddingTop);
          }
        }
        expect(rooms).toEqual([`${String(space.x6)}px`]);
      }
    }
  });

  it('a row lets its value move under its label, and cuts neither', () => {
    sized(NARROW);
    draw(fixtures.helloWorkerStale, { textScale: 1.3 });
    const value = screen.getByTestId('hello.status-worker');
    const row = value.parentElement?.parentElement;
    expect(row?.style.flexWrap).toBe('wrap');
    const texts = [...(row?.querySelectorAll<HTMLElement>('[dir]') ?? [])];
    expect(texts.map((text) => text.textContent)).toEqual(['Background jobs', STALE_WORKER]);
    for (const text of texts) {
      expect(text.style.whiteSpace).not.toBe('nowrap');
      expect(text.style.webkitLineClamp).toBeFalsy();
    }
    // The text follows the scale it is drawn at.
    expect(value.style.fontSize).toBe('20.8px');
  });

  it('keeps the same screen when the window changes size', () => {
    sized(EXPANDED);
    const root = draw(fixtures.helloReady);
    const title = screen.getByTestId('hello.title');
    sized(MEDIUM);
    sized(COMPACT);
    expect(screen.getByTestId('hello.screen')).toBe(root);
    expect(screen.getByTestId('hello.title')).toBe(title);
  });
});
