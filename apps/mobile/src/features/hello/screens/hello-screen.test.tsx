import { BRAND, typeRoles } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/hello/view-models/hello.fixtures';
import type { HelloViewModel } from '@/features/hello/view-models/hello.types';
import { getI18n } from '@/lib/i18n';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { setPageLoad } from '@/ui/first-screen';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';
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
const LARGE = [430, 932] as const;
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

/** The boxes drawn unseen: each holds words that only give a box its size. */
function unseen(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('*')].filter(
    (element) => element.style.opacity === '0',
  );
}

/** The words a person can read: the text outside every box that is drawn unseen. */
function shown(root: HTMLElement): string {
  const boxes = unseen(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let words = '';
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node;
    if (!boxes.some((box) => box.contains(text))) {
      words += text.textContent ?? '';
    }
  }
  return words;
}

/** How a text is set: its face, its size and the line it stands on. */
function face(text: HTMLElement): string[] {
  const { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } = text.style;
  return [fontFamily, fontSize, fontWeight, lineHeight, letterSpacing];
}

/**
 * Tells a view its height, as the page does once it is laid out. jsdom lays nothing out, so the
 * handler the page keeps on the element is called directly:
 * https://github.com/necolas/react-native-web/blob/0.21.2/packages/react-native-web/src/modules/useElementLayout/index.js
 */
function layOut(element: Element | undefined, height: number): void {
  const handler: unknown =
    element === undefined ? undefined : Reflect.get(element, '__reactLayoutHandler');
  if (typeof handler !== 'function') {
    throw new Error('the view listens for no layout');
  }
  act(() => {
    Reflect.apply(handler, element, [
      { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } },
    ]);
  });
}

/** Lays out the words of a loading box: the height they take as they wrap, and that of one line. */
function measure(box: HTMLElement | undefined, height: number, line: number): void {
  layOut(box?.children[0], height);
  layOut(box?.children[1], line);
}

/** The title's bars as drawn: the width of their box, then each bar's width and height. */
function titleBars(root: HTMLElement): { box: string; bars: [width: string, height: string][] } {
  const box = root.querySelector('[role="progressbar"]')?.parentElement;
  if (box === null || box === undefined) {
    throw new Error('the title has no bars');
  }
  return {
    box: box.style.width,
    bars: [...box.querySelectorAll<HTMLElement>('[role="progressbar"]')].map((bar) => [
      bar.parentElement === box ? '' : (bar.parentElement?.style.width ?? ''),
      bar.querySelector<HTMLElement>('[style*="height"]')?.style.height ?? '',
    ]),
  };
}

/** The widths of the intro's bars as drawn: the block after the title's. */
function introBars(root: HTMLElement): string[] {
  const blocks = [...root.querySelectorAll<HTMLElement>('[role="progressbar"]')];
  const intro = blocks[titleBars(root).bars.length];
  return [...(intro?.querySelectorAll<HTMLElement>('[style*="height"]') ?? [])].map(
    (bar) => bar.style.width,
  );
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

  it('the first screen of a page load leaves the focus where the document starts it', () => {
    sized(EXPANDED);
    cleanup();
    setPageLoad('start');
    // The page opens on this screen: it loads, then it answers, and no route change brought it.
    const view = renderWithProviders(<HelloScreenView vm={fixtures.helloLoading} />);
    view.rerender(<HelloScreenView vm={fixtures.helloReady} />);
    expect(titles()).toEqual([screen.getByTestId('hello.title')]);
    // Nothing took the focus, so the first Tab reaches the first control of the page: the skip link.
    expect(document.activeElement).toBe(document.body);
    // Asking again keeps it there.
    view.rerender(<HelloScreenView vm={fixtures.helloRefreshing} />);
    view.rerender(<HelloScreenView vm={fixtures.helloReady} />);
    expect(document.activeElement).toBe(document.body);

    // The same screen, when a route change brings it, takes the focus to its title.
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

  it('error with a code whose text needs a value reads the generic text', () => {
    sized(COMPACT);
    draw({ status: 'error', code: 'handle_change_too_soon', onRetry: () => undefined });
    expect(titles().map((title) => title.textContent)).toEqual([getI18n().t('errors:generic')]);
    expect(titles()[0]?.textContent).toBe('Something went wrong. Try again.');
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
    expect(drawn).toHaveLength(11);
    expect(drawn.filter((block) => block.closest('[aria-hidden="true"]') === null)).toEqual(bars);
    expect(titles()).toEqual([]);
    expect(screen.queryByTestId('hello.refresh')).toBeNull();
    // Nothing is written yet. The only words are the ones that size their boxes, unseen and unsaid.
    expect(shown(root)).toBe('');
    for (const box of unseen(root)) {
      expect(box.getAttribute('aria-hidden')).toBe('true');
      expect(box.querySelector('[role="heading"], [data-testid]')).toBeNull();
    }
  });

  it('the loading skeleton has the shape of the ready screen', () => {
    /** The rules of the drawn screen, by color: the group's strong rule, then the soft ones. */
    const rules = (root: HTMLElement): string[] =>
      [...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
        .filter((element) => element.style.height === '1px' && element.children.length === 0)
        .map((element) => element.style.backgroundColor);
    /** The rows of checks: what stands between the rules, with something at each end. */
    const rows = (root: HTMLElement): HTMLElement[] =>
      [...root.querySelectorAll<HTMLElement>('[style*="min-height: 56px"]')].filter(
        (element) => element.style.justifyContent === 'space-between',
      );
    for (const viewport of [NARROW, COMPACT, MEDIUM, EXPANDED]) {
      sized(viewport);
      const ready = draw(fixtures.helloReady);
      const readyRules = rules(ready);
      const readyRows = rows(ready).map((row) => row.getAttribute('style'));
      expect(readyRules, String(viewport[0])).toHaveLength(3);
      expect(readyRows, String(viewport[0])).toHaveLength(3);

      const loading = draw(fixtures.helloLoading);
      // The same rules in the same order, and the same three rows in the same boxes.
      expect(rules(loading), String(viewport[0])).toEqual(readyRules);
      const loadingRows = rows(loading);
      expect(
        loadingRows.map((row) => row.getAttribute('style')),
        String(viewport[0]),
      ).toEqual(readyRows);
      // Each row holds a bar where the label stands and a shorter one where the value does.
      for (const row of loadingRows) {
        const bars = [...row.querySelectorAll<HTMLElement>('[role="progressbar"]')];
        expect(bars.map((bar) => bar.style.width)).toEqual(['88px', '60px']);
        expect(bars.map((bar) => bar.style.alignSelf)).toEqual(['flex-start', 'flex-start']);
      }
      // The title stands on two lines at compact, the last one short, and on one in a wider
      // column; the button block is as high as the button.
      const blocks = [...loading.querySelectorAll<HTMLElement>('[role="progressbar"]')];
      const compact = viewport[0] < 600;
      expect(blocks, String(viewport[0])).toHaveLength(compact ? 11 : 10);
      const titleBox = blocks[0]?.parentElement;
      expect(titleBox?.querySelectorAll('[role="progressbar"]'), String(viewport[0])).toHaveLength(
        compact ? 2 : 1,
      );
      expect(titleBox?.style.width, String(viewport[0])).toBe(compact ? '' : '80%');
      const button = blocks.at(-1)?.querySelector<HTMLElement>('[style*="height: 44px"]');
      expect(button, String(viewport[0])).not.toBeNull();
      expect(blocks.at(-1)?.style.width, String(viewport[0])).toBe('120px');
      expect(shown(loading), String(viewport[0])).toBe('');
    }
  });

  it('a loading box takes the size of the words to come, and its bars the lines they take', () => {
    const cases: [Viewport, RenderWithProvidersOptions, tight: boolean][] = [
      [NARROW, {}, false],
      [COMPACT, {}, false],
      [MEDIUM, {}, false],
      [EXPANDED, {}, false],
      [NARROW, { textScale: 1.3 }, false],
      [NARROW, {}, true],
    ];
    for (const [viewport, options, tight] of cases) {
      const name = `${String(viewport[0])} ${JSON.stringify(options)} ${String(tight)}`;
      sized(viewport);
      layout.isTight = tight;
      const ready = draw(fixtures.helloReady, options);
      const words = [
        getI18n().t('hello:title'),
        getI18n().t('hello:intro'),
        getI18n().t('hello:status.heading'),
      ];
      const faces = [
        face(screen.getByTestId('hello.title')),
        face(within(ready).getByText(words[1] ?? '')),
        face(screen.getByRole('heading', { level: 2 })),
      ];
      // A tight layout sets the title one role down.
      expect(faces[0]?.[1], name).toBe(
        `${String(typeRoles[tight ? 'title' : 'display'].size * (options.textScale ?? 1))}px`,
      );

      const loading = draw(fixtures.helloLoading, options);
      const boxes = unseen(loading);
      // The title, the intro and the group's heading, in the order the ready screen draws them.
      expect(boxes, name).toHaveLength(3);
      boxes.forEach((box, index) => {
        // The words as they wrap, then one line of them: the height of a line at this text size.
        const texts = within(box).getAllByText(words[index] ?? '');
        expect(texts, name).toHaveLength(2);
        expect(box.textContent, name).toBe(`${words[index] ?? ''}${words[index] ?? ''}`);
        for (const text of texts) {
          expect(face(text), name).toEqual(faces[index]);
        }
        // Neither stands in the way of a press or of a screen reader.
        expect(box.getAttribute('aria-hidden'), name).toBe('true');
        expect(box.style.pointerEvents, name).toBe('none');
      });
      expect(shown(loading), name).toBe('');
    }
    layout.isTight = false;

    // The bars follow the lines the words take, once the boxes are laid out.
    const title = typeRoles.display.lineHeight;
    const body = typeRoles.body.lineHeight;
    const bar = `${String(title - space.x2)}px`;

    // A wide phone: the title breaks once and the intro stands on one line.
    sized(LARGE);
    let root = draw(fixtures.helloLoading);
    // Before a box is measured, both break once at compact.
    expect(titleBars(root)).toEqual({
      box: '',
      bars: [
        ['', bar],
        ['60%', bar],
      ],
    });
    expect(introBars(root)).toEqual(['100%', '60%']);
    let [titleWords, introWords] = unseen(root);
    measure(titleWords, title * 2, title);
    measure(introWords, body, body);
    expect(titleBars(root)).toEqual({
      box: '',
      bars: [
        ['', bar],
        ['60%', bar],
      ],
    });
    expect(introBars(root)).toEqual(['60%']);
    // One progress bar still, and it is the first block.
    expect(screen.getAllByRole('progressbar')).toEqual([
      root.querySelector('[role="progressbar"]'),
    ]);

    // Wider yet and still compact: the title fits on one line, which stops short of its column.
    measure(titleWords, title, title);
    expect(titleBars(root)).toEqual({ box: '80%', bars: [['', bar]] });

    // Larger text on a narrow phone: three lines each, on a higher line.
    sized(NARROW);
    root = draw(fixtures.helloLoading, { textScale: 1.3 });
    [titleWords, introWords] = unseen(root);
    measure(titleWords, title * 1.3 * 3, title * 1.3);
    measure(introWords, body * 1.3 * 3, body * 1.3);
    const grown = `${String(title * 1.3 - space.x2)}px`;
    expect(titleBars(root)).toEqual({
      box: '',
      bars: [
        ['', grown],
        ['', grown],
        ['60%', grown],
      ],
    });
    expect(introBars(root)).toEqual(['100%', '100%', '60%']);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);

    // A wider column where the title still breaks: two bars, across the column.
    sized(MEDIUM);
    root = draw(fixtures.helloLoading);
    expect(titleBars(root)).toEqual({ box: '80%', bars: [['', bar]] });
    expect(introBars(root)).toEqual(['60%']);
    [titleWords, introWords] = unseen(root);
    measure(titleWords, title * 2, title);
    expect(titleBars(root)).toEqual({
      box: '',
      bars: [
        ['', bar],
        ['60%', bar],
      ],
    });
    // A box that has no height yet keeps the lines it started with.
    measure(introWords, 0, 0);
    expect(introBars(root)).toEqual(['60%']);
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
