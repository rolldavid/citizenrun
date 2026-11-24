import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { JSX, ReactElement } from 'react';
import { Keyboard } from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { Text } from '@/ui/components/text';
import { color, radius, rule, size, space } from '@/ui/tokens';

import { useBottomChromeHeight, useReportBottomChrome } from './bottom-chrome';
import { subscribeReselect } from './reselect';
import { TabBar } from './tab-bar';
import type { TabBarProps } from './tab-bar';
import { GROUND, PREVIEW, STATES } from './tab-bar.fixtures';

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

const STATE_NAMES = [
  'homeActive',
  'exploreActive',
  'activityActive',
  'profileActive',
  'activityUnread',
  'activityUnreadOverflow',
] as const;

const TABS = ['home', 'explore', 'post', 'activity', 'profile'] as const;

/** What a phone sends with its keyboard events; the bar reads none of it. */
const KEYBOARD_FRAME: KeyboardEvent = {
  duration: 0,
  easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 344 },
};

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one element, in place of whatever was drawn before. */
function draw(element: ReactElement, options: RenderWithProvidersOptions = {}): void {
  cleanup();
  renderWithProviders(element, options);
}

function drawState(state: StateName, options: RenderWithProvidersOptions = {}): void {
  draw(<TabBar {...STATES[state]} />, options);
}

function drawBar(props: Partial<TabBarProps> = {}, options: RenderWithProvidersOptions = {}): void {
  draw(<TabBar {...STATES.homeActive} {...props} />, options);
}

function tab(item: (typeof TABS)[number]): HTMLElement {
  return screen.getByTestId(`shell.tab-${item}`);
}

/** The one path of a cell's icon: its stroke is the icon's color, and its fill is that color or none. */
function iconOf(cell: HTMLElement): {
  stroke: string | null;
  fill: string | null;
  d: string | null;
} {
  const path = cell.querySelector('svg path');
  if (path === null) {
    throw new Error('the cell has no icon');
  }
  return {
    stroke: path.getAttribute('stroke'),
    fill: path.getAttribute('fill'),
    d: path.getAttribute('d'),
  };
}

/** The view inside a press target that holds its content: the one a press under reduced motion fills. */
function contentOf(cell: HTMLElement): HTMLElement {
  const content = cell.querySelector<HTMLElement>('[style*="min-height"]');
  if (content === null) {
    throw new Error('the cell has no content');
  }
  return content;
}

/** Covers the bottom edge by a height while it is mounted, as the bar and a screen's footer do. */
function Reporter({ height }: { height: number }): null {
  useReportBottomChrome(height);
  return null;
}

/** Writes out the height that is covered at the bottom edge now. */
function Covered(): JSX.Element {
  return (
    <Text role="body" testID="probe.covered">
      {String(useBottomChromeHeight())}
    </Text>
  );
}

// A haptic is dropped when it follows another too closely, so each case starts a minute after the last.
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock += 60_000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TabBar', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        drawState(state, { theme });
        expect(screen.getAllByRole('link'), state).toHaveLength(5);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.homeActive).toMatchObject({ active: 'home', unreadActivity: 0 });
    expect(STATES.exploreActive.active).toBe('explore');
    expect(STATES.activityActive.active).toBe('activity');
    expect(STATES.profileActive.active).toBe('profile');
    expect(STATES.activityUnread.unreadActivity).toBe(3);
    expect(STATES.activityUnreadOverflow.unreadActivity).toBe(120);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has five links in order and no Messages', () => {
    drawState('homeActive');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Home',
      'Explore',
      'Post',
      'Activity',
      'Profile',
    ]);
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual(
      TABS.map((item) => `shell.tab-${item}`),
    );
    expect(screen.queryByRole('link', { name: /Messages/ })).toBeNull();
    expect(screen.queryByText('Messages')).toBeNull();
    // The cells are links in a navigation landmark, never tabs.
    expect(screen.getByRole('navigation', { name: 'Main' }).contains(links[0] ?? null)).toBe(true);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the active tab with aria-current', () => {
    const active = {
      homeActive: 'home',
      exploreActive: 'explore',
      activityActive: 'activity',
      profileActive: 'profile',
    } as const;
    for (const state of [
      'homeActive',
      'exploreActive',
      'activityActive',
      'profileActive',
    ] as const) {
      drawState(state);
      for (const item of TABS) {
        expect(tab(item).getAttribute('aria-current'), `${state} ${item}`).toBe(
          item === active[state] ? 'page' : null,
        );
      }
      expect(document.querySelectorAll('[aria-selected]'), state).toHaveLength(0);
    }
    drawBar({ active: 'post' });
    expect(tab('post').getAttribute('aria-current')).toBe('page');
    // Messages has no tab, so on its screens no tab is the current one.
    drawBar({ active: 'messages' });
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('draws the active tab filled and in ink, the others outlined in the secondary color', () => {
    for (const theme of ['light', 'dark'] as const) {
      drawState('exploreActive', { theme });
      expect(iconOf(tab('explore')), theme).toMatchObject({
        stroke: color[theme].text,
        fill: color[theme].text,
      });
      expect(iconOf(tab('home')), theme).toMatchObject({
        stroke: color[theme].textSecondary,
        fill: 'none',
      });
      expect(within(tab('explore')).getByText('Explore').style.color, theme).toBe(
        written(color[theme].text),
      );
      expect(within(tab('home')).getByText('Home').style.color, theme).toBe(
        written(color[theme].textSecondary),
      );
    }
    // The filled icon is another drawing of the same icon, and the active label is the stronger face.
    drawState('homeActive');
    const filled = iconOf(tab('home')).d;
    const strong = within(tab('home')).getByText('Home').style.fontFamily;
    drawState('exploreActive');
    expect(iconOf(tab('home')).d).not.toBe(filled);
    expect(within(tab('home')).getByText('Home').style.fontFamily).not.toBe(strong);
    expect(within(tab('explore')).getByText('Explore').style.fontFamily).toBe(strong);
    // No cell is an ink block for being active.
    expect(tab('explore').querySelector('[style*="background-color"]')).toBeNull();
  });

  it('draws Post as an ink block with a plus and no label', () => {
    for (const theme of ['light', 'dark'] as const) {
      drawState('homeActive', { theme });
      const post = tab('post');
      expect(post.textContent, theme).toBe('');
      const block = post.querySelector<HTMLElement>('[style*="background-color"]');
      expect(block?.style.backgroundColor, theme).toBe(written(color[theme].inverseBg));
      expect(block?.style.width, theme).toBe(`${String(size.postTabBlock.width)}px`);
      expect(block?.style.height, theme).toBe(`${String(size.postTabBlock.height)}px`);
      expect(block?.style.borderRadius, theme).toBe(`${String(radius.control)}px`);
      expect(iconOf(post).stroke, theme).toBe(color[theme].inverseText);
    }
  });

  it('names an unread count', () => {
    drawState('activityUnread');
    const unread = screen.getByRole('link', { name: 'Activity, 3 unread' });
    expect(unread).toBe(tab('activity'));
    expect(within(unread).getByText('3')).toBeDefined();
    // The word under the icon stays the tab's own.
    expect(within(unread).getByText('Activity')).toBeDefined();

    drawState('activityUnreadOverflow');
    const overflow = screen.getByRole('link', { name: 'Activity, 120 unread' });
    expect(within(overflow).getByText('99+')).toBeDefined();
    expect(within(overflow).queryByText('120')).toBeNull();

    // One unread reads the same way, and none draws no badge and no count in the name.
    drawBar({ unreadActivity: 1 });
    expect(screen.getByRole('link', { name: 'Activity, 1 unread' })).toBe(tab('activity'));
    drawBar({ unreadActivity: 0 });
    expect(tab('activity').getAttribute('aria-label')).toBe('Activity');
    expect(tab('activity').textContent).toBe('Activity');
  });

  it('changing tabs plays the selection haptic', () => {
    const onNavigate = vi.fn();
    const onReselect = vi.fn();
    drawBar({ active: 'home', onNavigate, onReselect });
    fireEvent.click(tab('explore'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('explore');
    expect(onReselect).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);

    vi.advanceTimersByTime(1000);
    fireEvent.click(tab('post'));
    expect(onNavigate).toHaveBeenLastCalledWith('post');
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }, { method: 'selection' }]);
  });

  it('Enter on a cell navigates, as a click does', () => {
    const onNavigate = vi.fn();
    drawBar({ active: 'home', onNavigate, onReselect: vi.fn() });
    // A cell is a link with no address: no browser follows it on Enter, so the cell presses itself.
    fireEvent.keyDown(tab('explore'), { key: 'Enter' });
    fireEvent.keyUp(tab('explore'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('explore');
  });

  it('the active tab reselects without a haptic', () => {
    const onNavigate = vi.fn();
    const onReselect = vi.fn();
    const home = vi.fn();
    const explore = vi.fn();
    const stopHome = subscribeReselect('home', home);
    const stopExplore = subscribeReselect('explore', explore);
    drawBar({ active: 'home', onNavigate, onReselect });
    fireEvent.click(tab('home'));
    expect(home).toHaveBeenCalledTimes(1);
    expect(onReselect).toHaveBeenCalledTimes(1);
    expect(onReselect).toHaveBeenCalledWith('home');
    expect(home.mock.invocationCallOrder[0]).toBeLessThan(
      onReselect.mock.invocationCallOrder[0] ?? 0,
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(explore).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    stopHome();
    stopExplore();
  });

  it('hides while the keyboard is open', () => {
    const listeners = new Map<string, (event: KeyboardEvent) => unknown>();
    const removed: string[] = [];
    vi.spyOn(Keyboard, 'addListener').mockImplementation((eventType, listener) => {
      listeners.set(eventType, listener);
      return {
        remove: () => {
          removed.push(eventType);
        },
      };
    });
    cleanup();
    const view = renderWithProviders(<TabBar {...STATES.homeActive} />);
    expect([...listeners.keys()].sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
    expect(screen.getByTestId('shell.tab-home')).toBeDefined();

    act(() => {
      listeners.get('keyboardDidShow')?.(KEYBOARD_FRAME);
    });
    expect(screen.queryByTestId('shell.tab-home')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();

    act(() => {
      listeners.get('keyboardDidHide')?.(KEYBOARD_FRAME);
    });
    expect(screen.getByTestId('shell.tab-home')).toBeDefined();

    // The bar stops listening when it leaves.
    expect(removed).toEqual([]);
    view.unmount();
    expect(removed.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
  });

  it('the height covered at the bottom edge follows its reporters', () => {
    const covered = (): string | null => screen.getByTestId('probe.covered').textContent;
    cleanup();
    const view = renderWithProviders(
      <>
        <Covered />
        <Reporter key="bar" height={56} />
      </>,
    );
    expect(covered()).toBe('56');

    // A taller footer on the same screen is what the content clears.
    view.rerender(
      <>
        <Covered />
        <Reporter key="bar" height={56} />
        <Reporter key="footer" height={88} />
      </>,
    );
    expect(covered()).toBe('88');

    // The footer leaves with its screen, and the bar reports 0 while the keyboard is open.
    view.rerender(
      <>
        <Covered />
        <Reporter key="bar" height={0} />
      </>,
    );
    expect(covered()).toBe('0');

    view.rerender(
      <>
        <Covered />
        <Reporter key="bar" height={56} />
      </>,
    );
    expect(covered()).toBe('56');
    view.rerender(<Covered />);
    expect(covered()).toBe('0');

    // The bar itself counts for nothing once it is gone.
    view.rerender(
      <>
        <Covered />
        <TabBar {...STATES.homeActive} />
      </>,
    );
    view.rerender(<Covered />);
    expect(covered()).toBe('0');
  });

  it('is the bar: a rule on top, the height of the token and the space above the icons', () => {
    for (const theme of ['light', 'dark'] as const) {
      drawState('homeActive', { theme });
      const bar = screen.getByRole('navigation');
      expect(bar.style.minHeight, theme).toBe(`${String(size.tabBar)}px`);
      expect(bar.style.paddingTop, theme).toBe(`${String(space.x1)}px`);
      expect(bar.style.paddingBottom, theme).toBe('0px');
      expect(bar.style.borderTopWidth, theme).toBe(`${String(rule.hairline)}px`);
      expect(bar.style.borderTopColor, theme).toBe(written(color[theme].rule));
      expect(bar.style.backgroundColor, theme).toBe(written(color[theme].bg));
      expect(bar.style.flexDirection, theme).toBe('row');
    }
    // Five equal cells, each at least the smallest target high.
    const cells = TABS.map((item) => tab(item).parentElement);
    for (const cell of cells) {
      expect(cell?.style.flexGrow).toBe('1');
    }
    for (const item of TABS) {
      expect(Number.parseFloat(contentOf(tab(item)).style.minHeight)).toBeGreaterThanOrEqual(
        size.target,
      );
    }
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      drawState(state);
      for (const item of TABS) {
        expect(tab(item).getAttribute('role'), `${state} ${item}`).toBe('link');
        expect(tab(item).getAttribute('aria-label'), `${state} ${item}`).toMatch(/^[A-Z]/);
        expect(tab(item).getAttribute('tabindex'), `${state} ${item}`).toBe('0');
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      drawState(state);
      const ids = [...document.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(TABS.map((item) => `shell.tab-${item}`));
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    drawBar({}, { reducedMotion: true, theme: 'light' });
    const reduced = tab('explore');
    fireEvent.keyDown(reduced, { key: 'Enter' });
    for (const part of [reduced, ...reduced.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    // The press shows as a fill instead.
    expect(contentOf(reduced).style.backgroundColor).toBe(written(color.light.pressedBg));
    fireEvent.keyUp(reduced, { key: 'Enter' });
    expect(contentOf(reduced).style.backgroundColor).toBe('');
    for (const part of [reduced, ...reduced.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }

    // The same press moves the cell's content where motion is allowed, and paints nothing.
    drawBar({}, { theme: 'light' });
    const moving = tab('explore');
    fireEvent.keyDown(moving, { key: 'Enter' });
    expect(
      [...moving.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
    ).toContain(MOVED);
    expect(contentOf(moving).style.backgroundColor).toBe('');
    fireEvent.keyUp(moving, { key: 'Enter' });
  });

  it('changing the active tab is a cut', () => {
    cleanup();
    const view = renderWithProviders(<TabBar {...STATES.homeActive} />);
    view.rerender(<TabBar {...STATES.exploreActive} />);
    expect(tab('explore').getAttribute('aria-current')).toBe('page');
    expect(tab('home').getAttribute('aria-current')).toBeNull();
    for (const part of screen.getByRole('navigation').querySelectorAll<HTMLElement>('*')) {
      expect(part.style.animationName).toBe('');
      // The only transition in the bar is the press, on transform.
      expect(['', 'transform']).toContain(part.style.transitionProperty);
    }
  });
});
