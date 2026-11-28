import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { JSX, ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { ShellLayout } from '@/ui/shells/app-shell';
import type { ShellLayoutProps } from '@/ui/shells/app-shell';
import { STATES as SHELL_STATES } from '@/ui/shells/app-shell.fixtures';
import { useBottomChromeHeight } from '@/ui/shells/bottom-chrome';
import { emitReselect } from '@/ui/shells/reselect';
import { layoutFor, useBreakpoint } from '@/ui/shells/use-breakpoint';
import { color, gutter, size, space } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { Screen } from './screen';
import type { ScreenProps } from './screen';
import { GROUND, PREVIEW, STATES } from './screen.fixtures';
import { Text } from './text';

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
// An interface icon loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an interface icon loads no asset');
  },
}));

type StateName = keyof typeof STATES;
type Width = NonNullable<ScreenProps['width']>;

const STATE_NAMES = [
  'screenAppBar',
  'homeAppBar',
  'noAppBar',
  'offline',
  'offlineWithRetry',
  'withFooter',
  'withAside',
  'widthLongForm',
  'widthFull',
] as const;

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

const OFFLINE = 'No connection. This may be out of date.';
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

/** The insets of a phone held on its side, with the camera at the left. */
const SIDE_INSETS = { top: 0, right: 21, bottom: 0, left: 47 };

/** The content the width cases look for. */
const PROBE = 'probe.content';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one element, in place of whatever was drawn before. */
function draw(element: ReactElement, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  return renderWithProviders(element, options).container;
}

function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  draw(<Screen {...STATES[state]} />, options);
  return screen.getByTestId(STATES[state].testID);
}

/** A screen inside the shell of the app, at the window's breakpoint. */
function inShell(
  shell: Partial<ShellLayoutProps>,
  props: ScreenProps,
  breakpoint: ShellLayoutProps['breakpoint'] = 'compact',
): JSX.Element {
  return (
    <ShellLayout {...SHELL_STATES.signedOutHome} breakpoint={breakpoint} {...shell}>
      <Screen {...props} />
    </ShellLayout>
  );
}

/** The scroll area of a screen. */
function scrollOf(testID: string): HTMLElement {
  return screen.getByTestId(`${testID}-scroll`);
}

/** A screen of one width around a probe, and the box the probe stands in. */
function boxAt(
  width: Width | undefined,
  viewport: readonly [number, number],
  more: Partial<ScreenProps> = {},
): HTMLElement {
  setViewport(viewport[0], viewport[1]);
  draw(
    <Screen testID="probe.screen" {...(width === undefined ? {} : { width })} {...more}>
      <View testID={PROBE} />
    </Screen>,
  );
  const box = screen.getByTestId(PROBE).parentElement;
  if (box === null) {
    throw new Error('the content has no box');
  }
  return box;
}

/** True when `later` comes after `earlier` in the document. */
function follows(earlier: Element, later: Element): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Writes out the height that is covered at the bottom edge now. */
function Covered(): JSX.Element {
  return (
    <Text role="body" testID="probe.covered">
      {String(useBottomChromeHeight())}
    </Text>
  );
}

/**
 * Tells a view its size, as the page does once it is laid out. jsdom lays nothing out, so the
 * handler the page keeps on the element is called directly:
 * https://github.com/necolas/react-native-web/blob/0.21.2/packages/react-native-web/src/modules/useElementLayout/index.js
 */
function layOut(element: Element, height: number): void {
  const handler: unknown = Reflect.get(element, '__reactLayoutHandler');
  if (typeof handler !== 'function') {
    throw new Error('the view listens for no layout');
  }
  act(() => {
    Reflect.apply(handler, element, [
      { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } },
    ]);
  });
}

describe('Screen', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const viewport of [NARROW, COMPACT, MEDIUM, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      for (const theme of ['light', 'dark'] as const) {
        for (const state of STATE_NAMES) {
          cleanup();
          renderWithProviders(
            <InteractionPreview state={PREVIEW[state] ?? {}}>
              <Screen {...STATES[state]} />
            </InteractionPreview>,
            { theme },
          );
          const root = screen.getByTestId(STATES[state].testID);
          expect(root.style.backgroundColor, state).toBe(written(color[theme].bg));
          expect(root.style.flexGrow, state).toBe('1');
          expect(
            within(root).getByText('Filing opens Mon, Jan 12 and closes Fri, Mar 6.'),
            state,
          ).toBeDefined();
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the nine states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.screenAppBar.appBar.variant).toBe('screen');
    expect(STATES.homeAppBar.appBar.variant).toBe('home');
    expect(STATES.noAppBar.appBar).toBeNull();
    expect(STATES.offline.offline).toBe(true);
    expect('onRetry' in STATES.offline).toBe(false);
    expect(typeof STATES.offlineWithRetry.onRetry).toBe('function');
    expect(STATES.withFooter.footer).toBeDefined();
    expect(STATES.withAside.aside).toBeDefined();
    expect(STATES.widthLongForm.width).toBe('longForm');
    expect(STATES.widthFull.width).toBe('full');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('marks main only when no shell did', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const root = drawState(state);
      const mains = screen.getAllByRole('main');
      expect(mains, state).toHaveLength(1);
      // The content is the landmark: it holds the children, inside the screen.
      expect(root.contains(mains[0] ?? null), state).toBe(true);
      expect(
        mains[0]?.contains(
          within(root).getByText('Filing opens Mon, Jan 12 and closes Fri, Mar 6.'),
        ),
        state,
      ).toBe(true);
    }
    // Inside the shell of the app the content slot is the landmark, and the screen adds none.
    for (const state of STATE_NAMES) {
      draw(inShell({}, STATES[state]));
      const mains = screen.getAllByRole('main');
      expect(mains, state).toHaveLength(1);
      expect(mains[0]?.contains(screen.getByTestId(STATES[state].testID)), state).toBe(true);
      expect(
        screen.getByTestId(STATES[state].testID).querySelectorAll('[role="main"]'),
        state,
      ).toHaveLength(0);
    }
    // A bare shell marks none, so the screen does.
    draw(inShell({ mode: 'bare', active: null }, STATES.screenAppBar));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(
      screen.getByTestId(STATES.screenAppBar.testID).querySelectorAll('[role="main"]'),
    ).toHaveLength(1);
  });

  it('keeps its content when the shell around it changes mode', () => {
    setViewport(...COMPACT);
    const under = (mode: ShellLayoutProps['mode']): JSX.Element =>
      inShell(
        { mode },
        {
          testID: 'probe.screen',
          footer: <View testID="probe.footer" />,
          children: <View testID={PROBE} />,
        },
      );
    cleanup();
    const view = renderWithProviders(under('app'));
    const root = screen.getByTestId('probe.screen');
    const content = screen.getByTestId(PROBE);
    const area = scrollOf('probe.screen');
    const footer = screen.getByTestId('probe.footer');
    const landmarks = (): Element[] => [...root.querySelectorAll('[role="main"]')];
    expect(landmarks()).toHaveLength(0);

    // A bare shell marks no main, so the screen's content becomes it, with every part where it was.
    view.rerender(under('bare'));
    expect(screen.getAllByRole('main')).toEqual(landmarks());
    expect(landmarks()).toHaveLength(1);
    expect(landmarks()[0]?.contains(content)).toBe(true);
    expect(landmarks()[0]?.contains(footer)).toBe(true);
    expect(screen.getByTestId('probe.screen')).toBe(root);
    expect(screen.getByTestId(PROBE)).toBe(content);
    expect(scrollOf('probe.screen')).toBe(area);
    expect(screen.getByTestId('probe.footer')).toBe(footer);

    // The shell's slot is the main again, and the screen gives the landmark up without a new mount.
    view.rerender(under('app'));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(landmarks()).toHaveLength(0);
    expect(screen.getByTestId(PROBE)).toBe(content);
    expect(scrollOf('probe.screen')).toBe(area);
    expect(screen.getByTestId('probe.footer')).toBe(footer);
  });

  it("draws the shell's banner under the app bar", () => {
    setViewport(...COMPACT);
    const banner = <Text role="body">Suspended</Text>;
    const content = 'Filing opens Mon, Jan 12 and closes Fri, Mar 6.';
    draw(inShell({ banner }, STATES.offline));
    const title = screen.getByRole('heading', { level: 1, name: 'Wren County' });
    const suspended = screen.getByText('Suspended');
    // The bar, the banner, the offline line, the content.
    expect(follows(title, suspended)).toBe(true);
    expect(follows(suspended, screen.getByText(OFFLINE))).toBe(true);
    expect(follows(screen.getByText(OFFLINE), screen.getByText(content))).toBe(true);
    expect(screen.getAllByText('Suspended')).toHaveLength(1);

    // Under a bar that scrolls away, and at the top of the content where there is no bar.
    draw(inShell({ banner }, STATES.homeAppBar));
    expect(follows(screen.getByRole('img'), screen.getByText('Suspended'))).toBe(true);
    expect(follows(screen.getByText('Suspended'), screen.getByText(content))).toBe(true);
    draw(inShell({ banner }, STATES.noAppBar));
    expect(follows(screen.getByText('Suspended'), screen.getByText(content))).toBe(true);
    // On a screen that does not scroll it stands above the child.
    draw(inShell({ banner }, { ...STATES.screenAppBar, scroll: false }));
    expect(follows(screen.getByText('Suspended'), screen.getByText(content))).toBe(true);

    // No shell, no banner.
    drawState('screenAppBar');
    expect(screen.queryByText('Suspended')).toBeNull();
  });

  it('shows the offline line with a retry', () => {
    setViewport(...COMPACT);
    const onRetry = vi.fn();
    const state = STATES.offlineWithRetry;
    draw(<Screen {...state} onRetry={onRetry} />);
    const root = screen.getByTestId(state.testID);
    const line = within(root).getByRole('status');
    expect(within(line).getByText(OFFLINE)).toBeDefined();
    const retry = within(line).getByTestId(`${state.testID}-offline-retry`);
    expect(retry.getAttribute('aria-label')).toBe('Try again');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Under the bar, above the content, at the gutter with room above and below it.
    const title = within(root).getByRole('heading', { level: 1 });
    expect(follows(title, line)).toBe(true);
    expect(
      follows(line, within(root).getByText('Filing opens Mon, Jan 12 and closes Fri, Mar 6.')),
    ).toBe(true);
    const holder = line.parentElement;
    expect(holder?.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(holder?.style.paddingRight).toBe(`${String(gutter.regular)}px`);
    expect(holder?.style.paddingTop).toBe(`${String(space.x3)}px`);
    expect(holder?.style.paddingBottom).toBe(`${String(space.x3)}px`);

    // Without a handler the line has no button; a screen that is not offline has no line.
    const plain = drawState('offline');
    expect(within(plain).getByRole('status').querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(within(drawState('screenAppBar')).queryByRole('status')).toBeNull();
  });

  it('draws the aside only at expanded', () => {
    const aside = 'Deadlines near you';
    setViewport(...EXPANDED);
    const expanded = drawState('withAside');
    const column = within(expanded).getByText(aside);
    // Beside the scroll area, not inside it, so it stays while the page scrolls.
    const area = scrollOf(STATES.withAside.testID);
    expect(area.contains(column)).toBe(false);
    expect(area.parentElement?.style.flexDirection).toBe('row');
    expect(area.parentElement?.style.paddingLeft).toBe(`${String(size.columnGap)}px`);
    expect(area.parentElement?.contains(column)).toBe(true);
    expect(follows(area, column)).toBe(true);
    // The feed column takes its width from the layout.
    const layout = layoutFor({ width: 1440, height: 900, fontScale: 1, topBarHeight: 0 });
    expect(area.style.width).toBe(`${String(layout.feedColumnWidth)}px`);

    for (const viewport of [MEDIUM, COMPACT]) {
      setViewport(viewport[0], viewport[1]);
      expect(within(drawState('withAside')).queryByText(aside), String(viewport[0])).toBeNull();
    }
    // A width with no right column draws none, at any breakpoint.
    setViewport(...EXPANDED);
    draw(<Screen {...STATES.withAside} width="column" />);
    expect(screen.queryByText(aside)).toBeNull();
  });

  it('the aside sits beside the scroll at expanded', () => {
    setViewport(...EXPANDED);
    draw(
      <Screen appBar={null} width="feed" testID="probe.screen" aside={<View testID="probe.card" />}>
        <View testID={PROBE} />
      </Screen>,
    );
    const area = scrollOf('probe.screen');
    const card = screen.getByTestId('probe.card');
    // The card is in no scrolling view the content is in: the page scrolls under it and it stays.
    expect(area.contains(screen.getByTestId(PROBE))).toBe(true);
    expect(area.contains(card)).toBe(false);
    const row = area.parentElement;
    expect(row?.contains(card)).toBe(true);
    expect(row?.style.flexDirection).toBe('row');
    expect(row === null ? '' : window.getComputedStyle(row).overflowY).not.toBe('auto');
    expect(row === null ? '' : window.getComputedStyle(row).overflowY).not.toBe('scroll');
    // The scroll area and the right column are the row's two children, in that order.
    const column = row?.children[1];
    expect(row?.children).toHaveLength(2);
    expect(row?.children[0]).toBe(area);
    expect(column?.contains(card)).toBe(true);
    expect(column instanceof HTMLElement ? column.style.width : '').toBe(
      `${String(size.rightColumn)}px`,
    );
    // A card taller than the window scrolls in its own column, apart from the page.
    expect(column === undefined ? '' : window.getComputedStyle(column).overflowY).toBe('auto');
    expect(window.getComputedStyle(area).overflowY).toBe('auto');
  });

  it('a home bar scrolls and a screen bar stays', () => {
    setViewport(...COMPACT);
    const home = drawState('homeAppBar');
    const mark = within(home).getByRole('img');
    expect(scrollOf(STATES.homeAppBar.testID).contains(mark)).toBe(true);
    // The bar is the first thing in the scroll content.
    expect(
      follows(mark, within(home).getByText('Filing opens Mon, Jan 12 and closes Fri, Mar 6.')),
    ).toBe(true);

    const stays = drawState('screenAppBar');
    const title = within(stays).getByRole('heading', { level: 1 });
    const area = scrollOf(STATES.screenAppBar.testID);
    expect(area.contains(title)).toBe(false);
    expect(follows(title, area)).toBe(true);

    // On a screen that does not scroll the bar of Home stands above the content.
    draw(<Screen {...STATES.homeAppBar} scroll={false} />);
    expect(screen.queryByTestId(`${STATES.homeAppBar.testID}-scroll`)).toBeNull();
    expect(
      follows(
        screen.getByRole('img'),
        screen.getByText('Filing opens Mon, Jan 12 and closes Fri, Mar 6.'),
      ),
    ).toBe(true);
  });

  it('sets a screen bar as wide as the content under it from medium up', () => {
    /** The box round the bar's title, and the ground round that box; null where the bar has none. */
    const barBoxOf = (
      width: Width | undefined,
      viewport: readonly [number, number],
    ): { box: HTMLElement; ground: HTMLElement } | null => {
      const content = boxAt(width, viewport, {
        appBar: { variant: 'screen', title: 'Settings', onBack: () => undefined },
      });
      const bar = screen.getByRole('heading', { level: 1 }).parentElement?.parentElement;
      const box = bar?.parentElement;
      const ground = box?.parentElement;
      if (!bar || !box || !ground) {
        throw new Error('the screen draws no bar');
      }
      // Where the bar has no box of its own it stands in the screen itself.
      if (box.getAttribute('data-testid') === 'probe.screen') {
        return null;
      }
      // The bar's box and the content's are as wide and in the same place.
      expect(box.style.maxWidth, String(width)).toBe(content.style.maxWidth);
      expect(box.style.alignSelf, String(width)).toBe(content.style.alignSelf);
      return { box, ground };
    };

    for (const viewport of [MEDIUM, EXPANDED]) {
      for (const [width, max] of [
        [undefined, size.feedColumn],
        ['column', size.feedColumn],
        ['longForm', size.longForm],
        ['profile', size.profileColumn],
      ] as const) {
        const found = barBoxOf(width, viewport);
        expect(found?.box.style.maxWidth, String(width)).toBe(`${String(max)}px`);
        expect(found?.box.style.width, String(width)).toBe('100%');
        expect(found?.box.style.alignSelf, String(width)).toBe('center');
        // The bar's ground still runs the width of the slot, over what scrolls under it.
        expect(found?.ground.style.backgroundColor, String(width)).toBe(written(color.light.bg));
        expect(found?.ground.style.maxWidth, String(width)).toBe('');
        expect(found?.ground.parentElement?.getAttribute('data-testid')).toBe('probe.screen');
      }
      // A page stands at the left beside its action card, centered below it, and its bar with it.
      expect(barBoxOf('page', viewport)?.box.style.alignSelf).toBe(
        viewport === EXPANDED ? 'flex-start' : 'center',
      );
      // Content that runs the width of the slot has a bar that does too.
      expect(barBoxOf('full', viewport)).toBeNull();
    }
    // On a phone the bar runs from edge to edge.
    for (const viewport of [NARROW, COMPACT]) {
      expect(barBoxOf('column', viewport)).toBeNull();
      expect(barBoxOf('longForm', viewport)).toBeNull();
    }
  });

  it('covers the top inset while the bar of Home scrolls', () => {
    setViewport(...COMPACT);
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    const onPhone = (props: ScreenProps): HTMLElement => {
      draw(
        <SafeAreaInsetsContext.Provider value={insets}>
          <Screen {...props} />
        </SafeAreaInsetsContext.Provider>,
      );
      return screen.getByTestId(props.testID);
    };
    const covers = (root: HTMLElement): HTMLElement[] =>
      [...root.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.style.position === 'absolute',
      );
    const home = covers(onPhone(STATES.homeAppBar));
    expect(home).toHaveLength(1);
    expect(home[0]?.style.height).toBe('47px');
    expect(home[0]?.getAttribute('aria-hidden')).toBe('true');
    // A bar that stays fills the inset itself.
    expect(covers(onPhone(STATES.screenAppBar))).toHaveLength(0);
    expect(covers(onPhone({ ...STATES.homeAppBar, scroll: false }))).toHaveLength(0);
  });

  it('keeps the top inset clear where it draws no bar', () => {
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    const onPhone = (props: ScreenProps): HTMLElement => {
      draw(
        <SafeAreaInsetsContext.Provider value={insets}>
          <Screen {...props} />
        </SafeAreaInsetsContext.Provider>,
      );
      return screen.getByTestId(props.testID);
    };
    const heading = (): HTMLElement => screen.getByText('Find an office');
    const bare: ScreenProps = {
      testID: 'probe.screen',
      children: <Text role="body">Find an office</Text>,
    };
    const plain: ScreenProps = { ...bare, appBar: null };

    // No bar: the inset stands in its place, on the page ground, above everything the screen draws.
    setViewport(...COMPACT);
    for (const props of [plain, { ...plain, scroll: false }, bare]) {
      const root = onPhone(props);
      const strip = root.firstElementChild;
      if (!(strip instanceof HTMLElement)) {
        throw new Error('the screen is empty');
      }
      expect(strip.style.height).toBe('47px');
      expect(strip.style.backgroundColor).toBe(written(color.light.bg));
      expect(strip.style.position).not.toBe('absolute');
      expect(strip.contains(heading())).toBe(false);
      expect(follows(strip, heading())).toBe(true);
    }

    // The bar of Home is not drawn from medium up: there the inset alone scrolls in its place, and
    // the cover keeps the status bar's ground.
    setViewport(...MEDIUM);
    const home = onPhone({ ...STATES.homeAppBar });
    const area = scrollOf(STATES.homeAppBar.testID);
    const scrolled = [...area.querySelectorAll<HTMLElement>('div')].filter(
      (element) => element.style.height === '47px' && element.style.position !== 'absolute',
    );
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.style.backgroundColor).toBe(written(color.light.bg));
    expect(home.contains(scrolled[0] ?? null)).toBe(true);

    // Where there is no inset, as on the web, nothing is added.
    setViewport(...COMPACT);
    draw(<Screen {...plain} />);
    const web = screen.getByTestId('probe.screen');
    expect(web.children).toHaveLength(1);
    expect(web.querySelectorAll('[style*="height: 47px"]')).toHaveLength(0);
  });

  it('scrolls to the top on a reselect of its tab', () => {
    setViewport(...COMPACT);
    const state = STATES.screenAppBar;
    const watch = (): ReturnType<typeof vi.fn> => {
      const scrollTo = vi.fn();
      // The page gives the scroll area its own `scrollTo`, which the screen calls through its ref.
      Object.defineProperty(scrollOf(state.testID), 'scrollTo', {
        configurable: true,
        value: scrollTo,
      });
      return scrollTo;
    };

    draw(inShell({ active: 'home' }, state));
    const moving = watch();
    emitReselect('explore');
    expect(moving).not.toHaveBeenCalled();
    emitReselect('home');
    expect(moving).toHaveBeenCalledTimes(1);
    expect(moving).toHaveBeenLastCalledWith({ x: 0, y: 0, animated: true });

    // Under reduced motion it jumps.
    draw(inShell({ active: 'home' }, state), { reducedMotion: true });
    const still = watch();
    emitReselect('home');
    expect(still).toHaveBeenCalledTimes(1);
    expect(still).toHaveBeenLastCalledWith({ x: 0, y: 0, animated: false });

    // Outside any shell there is no tab to choose again.
    drawState('screenAppBar');
    const alone = watch();
    emitReselect('home');
    expect(alone).not.toHaveBeenCalled();
  });

  it('keeps the tab it first drew under', () => {
    setViewport(...COMPACT);
    const state = STATES.screenAppBar;
    cleanup();
    const view = renderWithProviders(inShell({ active: 'home' }, state));
    const scrollTo = vi.fn();
    Object.defineProperty(scrollOf(state.testID), 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    // Another tab becomes the active one while this screen stays mounted under its own.
    view.rerender(inShell({ active: 'explore' }, state));
    emitReselect('explore');
    expect(scrollTo).not.toHaveBeenCalled();
    emitReselect('home');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    view.unmount();
    emitReselect('home');
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('scrolls in one direction, in one container, and lets a child that scrolls fill it', () => {
    setViewport(...COMPACT);
    const root = drawState('screenAppBar');
    const area = scrollOf(STATES.screenAppBar.testID);
    expect(root.querySelectorAll('[data-testid$="-scroll"]')).toHaveLength(1);
    // Vertical only.
    const drawn = window.getComputedStyle(area);
    expect(drawn.overflowY).toBe('auto');
    expect(drawn.overflowX).toBe('hidden');
    expect(area.style.flexGrow).toBe('1');

    // With scroll off the screen has no scroll area, and the child's box fills the screen.
    const box = boxAt('column', COMPACT, { scroll: false });
    expect(screen.queryByTestId('probe.screen-scroll')).toBeNull();
    expect(box.style.flexGrow).toBe('1');
    expect(box.parentElement?.style.flexGrow).toBe('1');
  });

  it('sets the content at the width asked for', () => {
    const regular = `${String(gutter.regular)}px`;
    // Default: a column at most the feed column wide, in the middle, with the gutter inside it.
    for (const width of [undefined, 'column'] as const) {
      const column = boxAt(width, EXPANDED);
      expect(column.style.maxWidth, String(width)).toBe(`${String(size.feedColumn)}px`);
      expect(column.style.width, String(width)).toBe('100%');
      expect(column.style.alignSelf, String(width)).toBe('center');
      expect(column.style.paddingLeft, String(width)).toBe(regular);
      expect(column.style.paddingRight, String(width)).toBe(regular);
    }
    const longForm = boxAt('longForm', EXPANDED);
    expect(longForm.style.maxWidth).toBe(`${String(size.longForm)}px`);
    expect(longForm.style.alignSelf).toBe('center');
    const profile = boxAt('profile', EXPANDED);
    expect(profile.style.maxWidth).toBe(`${String(size.profileColumn)}px`);
    expect(profile.style.alignSelf).toBe('center');
    // The whole slot, with the gutter.
    const full = boxAt('full', EXPANDED);
    expect(full.style.maxWidth).toBe('');
    expect(full.style.paddingLeft).toBe(regular);
    expect(full.style.paddingRight).toBe(regular);
    // Two panes side by side across the slot, with no gutter.
    const split = boxAt('split', EXPANDED, { scroll: false });
    expect(split.style.flexDirection).toBe('row');
    expect(split.style.paddingLeft).toBe('');
    expect(split.style.maxWidth).toBe('');
    // At the left, as wide as an office page between its gutters.
    const page = boxAt('page', EXPANDED);
    expect(page.style.alignSelf).toBe('flex-start');
    expect(page.style.maxWidth).toBe(`${String(size.officeContent + gutter.regular * 2)}px`);
    expect(page.style.paddingLeft).toBe(regular);

    // A narrow phone has the narrow gutter.
    expect(boxAt('column', NARROW).style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
  });

  it('sets the feed edge to edge at compact and as a column from medium up', () => {
    const compact = boxAt('feed', COMPACT);
    expect(compact.style.paddingLeft).toBe('');
    expect(compact.style.maxWidth).toBe('');
    expect(compact.style.width).toBe('');

    const medium = boxAt('feed', MEDIUM);
    const mediumLayout = layoutFor({ width: 820, height: 1180, fontScale: 1, topBarHeight: 0 });
    expect(medium.style.width).toBe(`${String(mediumLayout.feedColumnWidth)}px`);
    expect(medium.style.alignSelf).toBe('center');
    expect(medium.style.paddingLeft).toBe(`${String(gutter.feedColumnWide)}px`);

    // With no aside the column stays in the middle at expanded.
    const expanded = boxAt('feed', EXPANDED);
    const expandedLayout = layoutFor({ width: 1440, height: 900, fontScale: 1, topBarHeight: 0 });
    expect(expanded.style.width).toBe(`${String(expandedLayout.feedColumnWidth)}px`);
    expect(expanded.style.alignSelf).toBe('center');
  });

  it('a full-bleed feed stops at the side insets, and so does the layout under it', () => {
    /** Writes out the canvas width the layout gives where it is drawn. */
    function Canvas(props: { testID: string }): JSX.Element {
      return (
        <Text role="body" testID={props.testID}>
          {String(useBreakpoint().canvasWidth)}
        </Text>
      );
    }
    setViewport(...COMPACT);
    draw(
      <SafeAreaInsetsContext.Provider value={SIDE_INSETS}>
        <Canvas testID="probe.outside" />
        <Screen testID="probe.screen" appBar={null} width="feed">
          <View testID={PROBE} />
          <Canvas testID="probe.inside" />
        </Screen>
      </SafeAreaInsetsContext.Provider>,
    );
    // The box keeps no gutter, and starts and ends at the safe edges.
    const box = screen.getByTestId(PROBE).parentElement;
    expect(box?.style.paddingLeft).toBe(`${String(SIDE_INSETS.left)}px`);
    expect(box?.style.paddingRight).toBe(`${String(SIDE_INSETS.right)}px`);
    // Under the screen a canvas is as wide as the safe area; outside it, as wide as the window.
    expect(screen.getByTestId('probe.inside').textContent).toBe(
      String(COMPACT[0] - SIDE_INSETS.left - SIDE_INSETS.right),
    );
    expect(screen.getByTestId('probe.outside').textContent).toBe(String(COMPACT[0]));
  });

  it('sets a page as one centered column at medium, with its footer in that column', () => {
    const footer = <View testID="probe.footer" />;
    const page = boxAt('page', MEDIUM, { footer });
    expect(page.style.alignSelf).toBe('center');
    expect(page.style.width).toBe('100%');
    expect(page.style.maxWidth).toBe(`${String(size.officeContent + gutter.regular * 2)}px`);
    expect(page.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(page.style.paddingRight).toBe(`${String(gutter.regular)}px`);
    // The sticky row's box is the content's, so their edges are the same.
    const box = screen.getByTestId('probe.footer').parentElement;
    expect(box?.style.alignSelf).toBe(page.style.alignSelf);
    expect(box?.style.maxWidth).toBe(page.style.maxWidth);
    expect(box?.style.width).toBe(page.style.width);
    // On a phone the row runs from edge to edge.
    boxAt('page', COMPACT, { footer });
    expect(screen.getByTestId('probe.footer').parentElement?.style.maxWidth).toBe('');
    // Another width keeps its footer across the slot.
    boxAt('column', MEDIUM, { footer });
    expect(screen.getByTestId('probe.footer').parentElement?.style.maxWidth).toBe('');
  });

  it('a page with an aside keeps its gutter at the left and the right column beside it', () => {
    const box = boxAt('page', EXPANDED, { aside: <Text role="body">Run for this office</Text> });
    const area = scrollOf('probe.screen');
    expect(box.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(box.style.paddingRight).toBe('');
    expect(area.style.maxWidth).toBe(`${String(size.officeContent + gutter.regular)}px`);
    expect(area.parentElement?.style.flexDirection).toBe('row');
    const aside = screen.getByText('Run for this office');
    expect(area.contains(aside)).toBe(false);
    expect(follows(area, aside)).toBe(true);
  });

  it('adds the left and right insets to the gutter, and no other inset', () => {
    setViewport(...COMPACT);
    draw(
      <SafeAreaInsetsContext.Provider value={{ ...SIDE_INSETS, top: 30, bottom: 20 }}>
        <Screen testID="probe.screen" appBar={null} offline>
          <View testID={PROBE} />
        </Screen>
      </SafeAreaInsetsContext.Provider>,
    );
    const box = screen.getByTestId(PROBE).parentElement;
    expect(box?.style.paddingLeft).toBe(`${String(gutter.regular + SIDE_INSETS.left)}px`);
    expect(box?.style.paddingRight).toBe(`${String(gutter.regular + SIDE_INSETS.right)}px`);
    expect(box?.style.paddingTop).toBe('');
    expect(box?.style.paddingBottom).toBe('');
    const line = screen.getByRole('status').parentElement;
    expect(line?.style.paddingLeft).toBe(`${String(gutter.regular + SIDE_INSETS.left)}px`);
    // The screen itself pads nothing at the top or the bottom: the bars do.
    const root = screen.getByTestId('probe.screen');
    expect(root.style.paddingTop).toBe('');
    expect(root.style.paddingBottom).toBe('');
  });

  it('keeps the footer under the content and reports the height it covers', () => {
    setViewport(...COMPACT);
    const state = STATES.withFooter;
    draw(
      <>
        <Screen {...state} />
        <Covered />
      </>,
    );
    const root = screen.getByTestId(state.testID);
    const save = within(root).getByTestId('gallery.screen-save');
    const area = scrollOf(state.testID);
    // Outside the scroll area, after it, inside the landmark: it stays while the content scrolls.
    expect(area.contains(save)).toBe(false);
    expect(follows(area, save)).toBe(true);
    expect(within(root).getByRole('main').contains(save)).toBe(true);

    expect(screen.getByTestId('probe.covered').textContent).toBe('0');
    const footer = [...(area.parentElement?.parentElement?.children ?? [])].find((child) =>
      child.contains(save),
    );
    if (footer === undefined) {
      throw new Error('the footer has no box');
    }
    layOut(footer, 68);
    expect(screen.getByTestId('probe.covered').textContent).toBe('68');
    // A screen with no footer covers nothing.
    draw(
      <>
        <Screen {...STATES.screenAppBar} />
        <Covered />
      </>,
    );
    expect(screen.getByTestId('probe.covered').textContent).toBe('0');
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const root = drawState(state);
      for (const control of root.querySelectorAll<HTMLElement>(
        'a, button, [role="button"], [role="link"]',
      )) {
        expect(control.getAttribute('role') ?? control.tagName.toLowerCase(), state).toBe('button');
        expect(control.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
        expect(control.getAttribute('data-testid'), state).toMatch(TEST_ID);
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    const expected: Record<StateName, string[]> = {
      screenAppBar: ['shell.app-bar-back'],
      homeAppBar: ['shell.app-bar-messages'],
      noAppBar: [],
      offline: ['shell.app-bar-back'],
      offlineWithRetry: ['shell.app-bar-back', 'gallery.screen-offline-with-retry-offline-retry'],
      withFooter: ['shell.app-bar-back', 'gallery.screen-save'],
      withAside: [],
      widthLongForm: ['shell.app-bar-back'],
      widthFull: ['shell.app-bar-back'],
    };
    for (const state of STATE_NAMES) {
      const root = drawState(state);
      const id = STATES[state].testID;
      expect(id, state).toMatch(TEST_ID);
      expect(root.getAttribute('data-testid'), state).toBe(id);
      const ids = [...root.querySelectorAll('[data-testid]')]
        .map((element) => element.getAttribute('data-testid'))
        .filter((each) => each !== `${id}-scroll`);
      expect(ids, state).toEqual(expected[state]);
      // The scroll area takes the screen's id with its part.
      expect(scrollOf(id).getAttribute('data-testid'), state).toMatch(TEST_ID);
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    const id = `${STATES.offlineWithRetry.testID}-offline-retry`;
    drawState('offlineWithRetry', { reducedMotion: true });
    const still = screen.getByTestId(id);
    fireEvent.keyDown(still, { key: 'Enter' });
    for (const part of [still, ...still.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    fireEvent.keyUp(still, { key: 'Enter' });
    // The same press moves the button where motion is allowed; the frame itself never animates.
    const root = drawState('offlineWithRetry');
    const button = screen.getByTestId(id);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(
      [...button.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
    ).toContain(MOVED);
    fireEvent.keyUp(button, { key: 'Enter' });
    for (const part of root.querySelectorAll<HTMLElement>('*')) {
      expect(part.style.animationName).toBe('');
    }
  });
});
