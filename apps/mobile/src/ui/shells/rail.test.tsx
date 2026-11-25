import { BRAND } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, radius, rule, size, space } from '@/ui/tokens';

import { Rail } from './rail';
import type { RailProps } from './rail';
import { GROUND, PREVIEW, STATES } from './rail.fixtures';
import { subscribeReselect } from './reselect';

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
  'iconsHome',
  'iconsUnread',
  'labeledHome',
  'labeledUnread',
  'labeledWithPlace',
  'labeledNoActive',
] as const;

const ITEMS = ['home', 'explore', 'post', 'activity', 'messages', 'profile'] as const;
const NAMES = ['Home', 'Explore', 'Post', 'Activity', 'Messages', 'Profile'];

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

function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  draw(<Rail {...STATES[state]} />, options);
  return screen.getByTestId('shell.rail');
}

function drawRail(
  props: Partial<RailProps> = {},
  options: RenderWithProvidersOptions = {},
): HTMLElement {
  draw(<Rail {...STATES.labeledHome} {...props} />, options);
  return screen.getByTestId('shell.rail');
}

function item(name: (typeof ITEMS)[number]): HTMLElement {
  return screen.getByTestId(`shell.rail-${name}`);
}

/** The press targets of the rail, in the order they are drawn. */
function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="shell.rail-"]')];
}

/** The one path of an item's icon: its stroke is the icon's color, and its fill is that color or none. */
function iconOf(target: HTMLElement): { stroke: string | null; fill: string | null } {
  const path = target.querySelector('svg path');
  if (path === null) {
    throw new Error('the item has no icon');
  }
  return { stroke: path.getAttribute('stroke'), fill: path.getAttribute('fill') };
}

/** The bars of the active item: the views the rail paints in the text color at its left edge. */
function bars(rail: HTMLElement, theme: 'light' | 'dark' = 'light'): HTMLElement[] {
  return [...rail.querySelectorAll<HTMLElement>('[style*="position: absolute"]')].filter(
    (element) => element.style.backgroundColor === written(color[theme].text),
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

describe('Rail', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const rail = drawState(state, { theme });
        expect(items(), state).toHaveLength(6);
        expect(rail.style.backgroundColor, state).toBe(written(color[theme].bg));
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.iconsHome).toMatchObject({ variant: 'icons', active: 'home', place: null });
    expect(STATES.iconsUnread.unread).toEqual({ messages: 3, activity: 12 });
    expect(STATES.labeledHome).toMatchObject({ variant: 'labeled', active: 'home', place: null });
    expect(STATES.labeledUnread.unread).toEqual({ messages: 3, activity: 12 });
    expect(STATES.labeledWithPlace.place).toEqual({
      name: 'Wren County',
      districtCount: 14,
      officeCount: 38,
    });
    expect(STATES.labeledNoActive.active).toBeNull();
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('lists the mark and six items in order', () => {
    for (const state of ['labeledHome', 'iconsHome'] as const) {
      const rail = drawState(state);
      const mark = within(rail).getByRole('img', { name: BRAND.displayName });
      expect(within(rail).getAllByRole('img'), state).toHaveLength(1);
      expect(
        items().map((target) => target.getAttribute('aria-label')),
        state,
      ).toEqual(NAMES);
      expect(
        items().map((target) => target.getAttribute('data-testid')),
        state,
      ).toEqual(ITEMS.map((name) => `shell.rail-${name}`));
      // The mark comes first.
      const first = items()[0];
      expect(first, state).toBeDefined();
      expect(
        first === undefined
          ? 0
          : mark.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
        state,
      ).not.toBe(0);
    }
    // The labeled rail writes each name out; the icons rail only names its items.
    const labeled = drawState('labeledHome');
    for (const name of NAMES) {
      expect(within(labeled).getByText(name), name).toBeDefined();
    }
    const icons = drawState('iconsHome');
    for (const name of NAMES) {
      expect(within(icons).queryByText(name), name).toBeNull();
    }
  });

  it('is a navigation landmark named Main, at the width of its variant', () => {
    for (const theme of ['light', 'dark'] as const) {
      const labeled = drawState('labeledHome', { theme });
      expect(screen.getByRole('navigation', { name: 'Main' })).toBe(labeled);
      expect(labeled.style.width).toBe(`${String(size.rail)}px`);
      expect(labeled.style.paddingTop).toBe(`${String(space.x6)}px`);
      expect(labeled.style.paddingLeft).toBe(`${String(space.x3)}px`);
      expect(labeled.style.borderRightWidth).toBe(`${String(rule.hairline)}px`);
      expect(labeled.style.borderRightColor).toBe(written(color[theme].rule));

      const icons = drawState('iconsHome', { theme });
      expect(screen.getByRole('navigation', { name: 'Main' })).toBe(icons);
      expect(icons.style.width).toBe(`${String(size.railIcon)}px`);
      expect(icons.style.paddingTop).toBe(`${String(space.x6)}px`);
      expect(icons.style.borderRightWidth).toBe(`${String(rule.hairline)}px`);
      expect(icons.style.borderRightColor).toBe(written(color[theme].rule));
    }
  });

  it('draws the wordmark in the labeled rail and the two letters in the icons rail', () => {
    const wordmark = within(drawState('labeledHome')).getByRole('img');
    expect(wordmark.style.height).toBe(`${String(size.wordmarkCap.rail)}px`);
    expect(wordmark.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 6249 710');
    expect(wordmark.parentElement?.style.marginBottom).toBe(`${String(space.x8)}px`);

    const monogram = within(drawState('iconsHome')).getByRole('img');
    expect(monogram.style.height).toBe(`${String(size.monogramRail)}px`);
    expect(monogram.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1685 710');
    expect(monogram.parentElement?.style.alignItems).toBe('center');
  });

  it('Post is a button and the rest are links', () => {
    for (const state of ['labeledHome', 'iconsHome'] as const) {
      const rail = drawState(state);
      expect(within(rail).getByRole('button', { name: 'Post' }), state).toBe(item('post'));
      expect(within(rail).getAllByRole('button'), state).toHaveLength(1);
      expect(
        within(rail)
          .getAllByRole('link')
          .map((link) => link.getAttribute('aria-label')),
        state,
      ).toEqual(['Home', 'Explore', 'Activity', 'Messages', 'Profile']);
    }
  });

  it('marks the active item with aria-current', () => {
    for (const state of ['labeledHome', 'iconsHome'] as const) {
      drawState(state);
      for (const name of ITEMS) {
        expect(item(name).getAttribute('aria-current'), `${state} ${name}`).toBe(
          name === 'home' ? 'page' : null,
        );
      }
      expect(document.querySelectorAll('[aria-selected]'), state).toHaveLength(0);
    }
    drawRail({ active: 'messages' });
    expect(item('messages').getAttribute('aria-current')).toBe('page');
    expect(item('home').getAttribute('aria-current')).toBeNull();

    drawState('labeledNoActive');
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-selected]')).toHaveLength(0);
  });

  it('draws the active item with a bar at the left edge, the filled icon and the stronger label', () => {
    for (const theme of ['light', 'dark'] as const) {
      const labeled = drawState('labeledHome', { theme });
      const [bar, ...others] = bars(labeled, theme);
      expect(others, theme).toHaveLength(0);
      expect(bar?.style.width, theme).toBe(`${String(rule.active)}px`);
      expect(bar?.style.top, theme).toBe(`${String(space.x2)}px`);
      expect(bar?.style.bottom, theme).toBe(`${String(space.x2)}px`);
      // The rows stand clear of the rail's edge, and the bar reaches back to it.
      expect(bar?.style.left, theme).toBe(`${String(-space.x3)}px`);
      // The bar stands beside the press target, not in it: a press moves the row and leaves the bar.
      expect(bar?.parentElement, theme).toBe(item('home').parentElement);
      expect(item('home').contains(bar ?? null), theme).toBe(false);
      expect(iconOf(item('home')), theme).toEqual({
        stroke: color[theme].text,
        fill: color[theme].text,
      });
      expect(iconOf(item('explore')), theme).toEqual({ stroke: color[theme].text, fill: 'none' });
      // Never an ink block.
      expect(item('home').querySelector('[style*="background-color"]'), theme).toBeNull();

      const icons = drawState('iconsHome', { theme });
      const [edge, ...rest] = bars(icons, theme);
      expect(rest, theme).toHaveLength(0);
      expect(edge?.style.width, theme).toBe(`${String(rule.active)}px`);
      expect(edge?.style.left, theme).toBe('0px');
      expect(edge?.style.top, theme).toBe(`${String(space.x2)}px`);
      expect(edge?.style.bottom, theme).toBe(`${String(space.x2)}px`);
      expect(item('home').contains(edge ?? null), theme).toBe(false);
      expect(iconOf(item('home')).fill, theme).toBe(color[theme].text);
    }
    drawState('labeledHome');
    const strong = within(item('home')).getByText('Home').style.fontFamily;
    expect(within(item('explore')).getByText('Explore').style.fontFamily).not.toBe(strong);
    // No active item, no bar.
    expect(bars(drawState('labeledNoActive'))).toHaveLength(0);
  });

  it('names unread counts', () => {
    const labeled = drawState('labeledUnread');
    const messages = within(labeled).getByRole('link', { name: 'Messages, 3 unread' });
    const activity = within(labeled).getByRole('link', { name: 'Activity, 12 unread' });
    expect(messages).toBe(item('messages'));
    expect(activity).toBe(item('activity'));
    expect(within(messages).getByText('3')).toBeDefined();
    expect(within(activity).getByText('12')).toBeDefined();
    // The word in the row stays the item's own.
    expect(within(messages).getByText('Messages')).toBeDefined();

    const icons = drawState('iconsUnread');
    expect(within(icons).getByRole('link', { name: 'Messages, 3 unread' })).toBe(item('messages'));
    expect(within(icons).getByRole('link', { name: 'Activity, 12 unread' })).toBe(item('activity'));
    expect(within(item('messages')).getByText('3')).toBeDefined();
    expect(within(item('activity')).getByText('12')).toBeDefined();

    // No count, no badge and no count in the name.
    drawState('labeledHome');
    expect(item('messages').getAttribute('aria-label')).toBe('Messages');
    expect(item('messages').textContent).toBe('Messages');
    drawState('iconsHome');
    expect(item('activity').getAttribute('aria-label')).toBe('Activity');
    expect(item('activity').textContent).toBe('');

    drawRail({ unread: { messages: 1, activity: 120 } });
    expect(item('messages').getAttribute('aria-label')).toBe('Messages, 1 unread');
    expect(item('activity').getAttribute('aria-label')).toBe('Activity, 120 unread');
    expect(within(item('activity')).getByText('99+')).toBeDefined();
  });

  it('shows the place in the labeled foot', () => {
    for (const theme of ['light', 'dark'] as const) {
      const rail = drawState('labeledWithPlace', { theme });
      const name = within(rail).getByText('Wren County');
      const districts = within(rail).getByText('14 districts');
      const offices = within(rail).getByText('38 offices');
      for (const line of [name, districts, offices]) {
        expect(line.style.color, theme).toBe(written(color[theme].textSecondary));
      }
      // The two counts are two strings on one row, with a dot between them that is not read out.
      expect(districts.parentElement, theme).toBe(offices.parentElement);
      expect(districts.parentElement?.style.flexDirection, theme).toBe('row');
      const dot = districts.nextElementSibling;
      expect(dot?.nextElementSibling, theme).toBe(offices);
      expect(dot?.getAttribute('aria-hidden'), theme).toBe('true');
      expect(dot?.textContent, theme).toMatch(/^[^\p{L}\p{N}]$/u);
      // The foot is under the items, after a spacer that takes the room between them.
      const last = items().at(-1);
      expect(
        last === undefined
          ? 0
          : last.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
        theme,
      ).not.toBe(0);
      expect(name.parentElement?.previousElementSibling, theme).not.toBeNull();
      const spacer = name.parentElement?.previousElementSibling;
      expect(spacer instanceof HTMLElement ? spacer.style.flexGrow : null, theme).toBe('1');
      expect(rail.style.paddingBottom, theme).toBe(`${String(space.x6)}px`);
    }
  });

  it('counts one district and one office in the singular', () => {
    const rail = drawRail({ place: { name: 'Alder', districtCount: 1, officeCount: 1 } });
    expect(within(rail).getByText('Alder')).toBeDefined();
    expect(within(rail).getByText('1 district')).toBeDefined();
    expect(within(rail).getByText('1 office')).toBeDefined();
  });

  it('hides the foot without a place and in the icons rail', () => {
    const without = drawState('labeledHome');
    expect(within(without).queryByText(/districts?$/)).toBeNull();
    expect(within(without).queryByText(/offices?$/)).toBeNull();

    const icons = drawRail({ ...STATES.labeledWithPlace, variant: 'icons' });
    expect(within(icons).queryByText('Wren County')).toBeNull();
    expect(within(icons).queryByText(/districts?$/)).toBeNull();
    expect(within(icons).queryByText(/offices?$/)).toBeNull();
    expect(icons.textContent).toBe('');
  });

  it('changing items plays the selection haptic', () => {
    const onNavigate = vi.fn();
    const onReselect = vi.fn();
    drawRail({ active: 'home', onNavigate, onReselect });
    fireEvent.click(item('explore'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('explore');
    expect(onReselect).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);

    vi.advanceTimersByTime(1000);
    drawRail({ ...STATES.iconsHome, onNavigate, onReselect });
    fireEvent.click(item('post'));
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenLastCalledWith('post');
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }, { method: 'selection' }]);
  });

  it('Enter on an item navigates, as a click does', () => {
    const onNavigate = vi.fn();
    drawRail({ active: 'home', onNavigate, onReselect: vi.fn() });
    // An item is a link with no address: no browser follows it on Enter, so the item presses itself.
    fireEvent.keyDown(item('explore'), { key: 'Enter' });
    fireEvent.keyUp(item('explore'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('explore');
  });

  it('the active item calls onReselect alone', () => {
    const onNavigate = vi.fn();
    const onReselect = vi.fn();
    const listener = vi.fn();
    const stop = subscribeReselect('home', listener);
    for (const variant of ['labeled', 'icons'] as const) {
      drawRail({ variant, active: 'home', onNavigate, onReselect });
      fireEvent.click(item('home'));
    }
    expect(onReselect).toHaveBeenCalledTimes(2);
    expect(onReselect).toHaveBeenCalledWith('home');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    // The shell sends the reselect signal for the rail; the rail sends none of its own.
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      drawState(state);
      for (const name of ITEMS) {
        const target = item(name);
        expect(target.getAttribute('role'), `${state} ${name}`).toBe(
          name === 'post' ? 'button' : 'link',
        );
        expect(target.getAttribute('aria-label'), `${state} ${name}`).toMatch(/^[A-Z]/);
        expect(target.tabIndex, `${state} ${name}`).toBe(0);
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      drawState(state);
      const ids = [...document.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(['shell.rail', ...ITEMS.map((name) => `shell.rail-${name}`)]);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('gives every item the smallest target at least', () => {
    drawState('labeledHome');
    for (const name of ITEMS) {
      const row = item(name).querySelector<HTMLElement>('[style*="min-height"]');
      expect(row?.style.minHeight, name).toBe(`${String(size.railItem)}px`);
      expect(size.railItem, name).toBeGreaterThanOrEqual(size.target);
    }
    drawState('iconsHome');
    for (const name of ITEMS) {
      const square = item(name).querySelector<HTMLElement>('[style*="justify-content"]');
      expect(square?.style.width, name).toBe(`${String(size.target)}px`);
      expect(square?.style.height, name).toBe(`${String(size.target)}px`);
      // The press target is the square itself, centered in the rail.
      expect(item(name).parentElement?.style.width, name).toBe(`${String(size.target)}px`);
      expect(item(name).parentElement?.parentElement?.style.alignItems, name).toBe('center');
    }
  });

  it('respects reduced motion', () => {
    // Under reduced motion a pressed row shows the pressed fill and does not move.
    drawRail({}, { reducedMotion: true, theme: 'light' });
    const row = item('explore');
    fireEvent.keyDown(row, { key: 'Enter' });
    for (const part of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    expect(
      row.querySelector<HTMLElement>('[style*="background-color"]')?.style.backgroundColor,
    ).toBe(written(color.light.pressedBg));
    fireEvent.keyUp(row, { key: 'Enter' });

    // The square of the icons rail has no fill of its own to show, so it takes the pressed fill.
    drawRail({ variant: 'icons' }, { reducedMotion: true, theme: 'light' });
    const square = item('explore');
    fireEvent.keyDown(square, { key: 'Enter' });
    for (const part of [square, ...square.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    const filled = square.querySelector<HTMLElement>('[style*="background-color"]');
    expect(filled?.style.backgroundColor).toBe(written(color.light.pressedBg));
    expect(filled?.style.borderRadius).toBe(`${String(radius.control)}px`);
    fireEvent.keyUp(square, { key: 'Enter' });
    expect(square.querySelector('[style*="background-color"]')).toBeNull();

    // The same press moves the item where motion is allowed.
    for (const variant of ['labeled', 'icons'] as const) {
      drawRail({ variant });
      const moving = item('explore');
      fireEvent.keyDown(moving, { key: 'Enter' });
      expect(
        [...moving.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
        variant,
      ).toContain(MOVED);
      fireEvent.keyUp(moving, { key: 'Enter' });
    }
  });

  it('changing the active item is a cut', () => {
    cleanup();
    const view = renderWithProviders(<Rail {...STATES.labeledHome} />);
    const rail = screen.getByTestId('shell.rail');
    view.rerender(<Rail {...STATES.labeledHome} active="explore" />);
    expect(item('explore').getAttribute('aria-current')).toBe('page');
    expect(item('home').getAttribute('aria-current')).toBeNull();
    expect(bars(rail)).toHaveLength(1);
    expect(bars(rail)[0]?.parentElement).toBe(item('explore').parentElement);
    for (const part of rail.querySelectorAll<HTMLElement>('*')) {
      expect(part.style.animationName).toBe('');
      // The only transition in the rail is the press, on transform.
      expect(['', 'transform']).toContain(part.style.transitionProperty);
    }
  });

  it('the icon rail shows a tooltip on focus', async () => {
    const rail = drawState('iconsHome');
    // The icons rail draws no word, so nothing names an icon for the eye until it has the focus.
    expect(within(rail).queryByText('Explore')).toBeNull();
    // The Tab key brings focus, which the page marks as the keyboard's.
    act(() => {
      item('explore').focus();
    });
    // The page says where the cell is on the next turn.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    const words = within(rail).getByText('Explore');
    expect(words.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(item('explore').contains(words)).toBe(false);
    // The item keeps its one name, and the other icons show nothing.
    expect(within(rail).getAllByRole('link', { name: 'Explore' })).toEqual([item('explore')]);
    expect(within(rail).queryByText('Home')).toBeNull();
    fireEvent.blur(item('explore'));
    expect(within(rail).queryByText('Explore')).toBeNull();

    // The count is in the item's name; the tooltip says the word alone.
    drawState('iconsUnread');
    // The Tab key brings focus, which the page marks as the keyboard's.
    act(() => {
      item('messages').focus();
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(screen.getByText('Messages').closest('[aria-hidden="true"]')).not.toBeNull();

    // The labeled rail shows its words already, so it has no tooltip.
    drawState('labeledHome');
    act(() => {
      item('explore').focus();
    });
    expect(screen.getAllByText('Explore')).toHaveLength(1);
  });
});
