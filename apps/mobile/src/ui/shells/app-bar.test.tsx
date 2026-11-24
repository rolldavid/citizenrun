import { BRAND } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { Text } from '@/ui/components/text';
import { color, gutter, size, space, z } from '@/ui/tokens';

import { AppBar, AppBarInsetCover } from './app-bar';
import type { AppBarProps } from './app-bar';
import { GROUND, PREVIEW, STATES } from './app-bar.fixtures';

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
  'homeNoMessages',
  'homeMessages',
  'homeUnread',
  'screen',
  'screenNoBack',
  'screenAction',
  'screenLongTitle',
] as const;

const COMPACT = [390, 844] as const;
const SMALL = [360, 740] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

/** The insets of a phone with a status bar and a home indicator. */
const PHONE_INSETS = { top: 47, right: 0, bottom: 34, left: 0 };

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

/** Renders one element, in place of whatever was drawn before, and gives back what it drew. */
function draw(element: ReactElement, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  return renderWithProviders(element, options).container;
}

function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  return draw(<AppBar {...STATES[state]} />, options);
}

/** Renders one element as a phone with a status bar would. */
function drawOnPhone(element: ReactElement): HTMLElement {
  return draw(
    <SafeAreaInsetsContext.Provider value={PHONE_INSETS}>{element}</SafeAreaInsetsContext.Provider>,
  );
}

/** The bar itself: the one row the component draws. */
function barOf(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>(
    '[style*="min-height"][style*="flex-direction"]',
  );
  if (bar === null) {
    throw new Error('no bar was drawn');
  }
  return bar;
}

describe('AppBar', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const bar = barOf(drawState(state, { theme }));
        expect(bar.style.backgroundColor, state).toBe(written(color[theme].bg));
        expect(bar.style.minHeight, state).toBe(`${String(size.appBar)}px`);
        // Never a rule under the bar.
        expect(bar.style.borderBottomWidth, state).toBe('');
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.homeNoMessages).toEqual({
      variant: 'home',
      unreadMessages: 0,
      onOpenMessages: null,
    });
    expect(STATES.homeMessages.unreadMessages).toBe(0);
    expect(STATES.homeMessages.onOpenMessages).toBeTypeOf('function');
    expect(STATES.homeUnread.unreadMessages).toBe(4);
    expect(STATES.screen).toMatchObject({ variant: 'screen', title: 'Settings' });
    expect(STATES.screen.onBack).toBeTypeOf('function');
    expect(STATES.screenNoBack.onBack).toBeNull();
    expect(STATES.screenAction.action).toMatchObject({
      icon: 'settings',
      label: 'Settings',
      testID: 'gallery.app-bar-action',
    });
    expect(STATES.screenLongTitle.title).toBe(
      'Wren County Board of Equalization and Assessment Appeals, District 4',
    );
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('home draws the wordmark and no Messages button without a handler', () => {
    setViewport(...COMPACT);
    const container = drawState('homeNoMessages');
    const mark = screen.getByRole('img', { name: BRAND.displayName });
    expect(mark.style.height).toBe(`${String(size.wordmarkCap.appBar)}px`);
    expect(mark.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 6249 710');
    expect(screen.queryByTestId('shell.app-bar-messages')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    // Home's bar has no title of its own, and it is not held at the top.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(barOf(container).style.zIndex).toBe('');
    expect(barOf(container).style.position).toBe('');
  });

  it('home sets the wordmark at the gutter', () => {
    setViewport(...COMPACT);
    expect(barOf(drawState('homeMessages')).style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(barOf(drawState('homeMessages')).style.paddingRight).toBe(`${String(space.x1)}px`);
    // A small phone has the narrow gutter.
    setViewport(...SMALL);
    expect(barOf(drawState('homeMessages')).style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
  });

  it('home names the Messages button with its count', () => {
    setViewport(...COMPACT);
    const onOpenMessages = vi.fn();
    draw(<AppBar {...STATES.homeUnread} onOpenMessages={onOpenMessages} />);
    const unread = screen.getByRole('button', { name: 'Messages, 4 unread' });
    expect(unread).toBe(screen.getByTestId('shell.app-bar-messages'));
    expect(within(unread).getByText('4')).toBeDefined();
    fireEvent.click(unread);
    expect(onOpenMessages).toHaveBeenCalledTimes(1);

    // No unread message: the plain name and no badge.
    drawState('homeMessages');
    const plain = screen.getByRole('button', { name: 'Messages' });
    expect(plain).toBe(screen.getByTestId('shell.app-bar-messages'));
    expect(plain.textContent).toBe('');

    draw(<AppBar variant="home" unreadMessages={1} onOpenMessages={onOpenMessages} />);
    expect(screen.getByRole('button', { name: 'Messages, 1 unread' })).toBeDefined();
    draw(<AppBar variant="home" unreadMessages={120} onOpenMessages={onOpenMessages} />);
    expect(
      within(screen.getByRole('button', { name: 'Messages, 120 unread' })).getByText('99+'),
    ).toBeDefined();
  });

  it('home draws nothing at medium and expanded', () => {
    for (const [width, height] of [MEDIUM, EXPANDED]) {
      setViewport(width, height);
      for (const state of ['homeNoMessages', 'homeMessages', 'homeUnread'] as const) {
        const container = drawState(state);
        expect(container.querySelector('[role], [data-testid], svg'), state).toBeNull();
        expect(container.textContent, state).toBe('');
      }
      // The bar of any other screen is drawn at every width.
      drawState('screen');
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeDefined();
    }
  });

  it('screen has a level 1 title, back and one action', () => {
    setViewport(...COMPACT);
    const onBack = vi.fn();
    const onPress = vi.fn();
    draw(
      <AppBar
        {...STATES.screenAction}
        onBack={onBack}
        action={{ ...STATES.screenAction.action, onPress }}
      />,
    );
    const title = screen.getByRole('heading', { name: 'Profile' });
    expect(title.getAttribute('aria-level')).toBe('1');
    expect(screen.getAllByRole('heading')).toHaveLength(1);

    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toBe(screen.getByTestId('shell.app-bar-back'));
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();

    const action = screen.getByRole('button', { name: 'Settings' });
    expect(action).toBe(screen.getByTestId('gallery.app-bar-action'));
    fireEvent.click(action);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(2);

    // Back, the title, the action: the order a reader meets them in.
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(title.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    drawState('screenNoBack');
    expect(screen.queryByTestId('shell.app-bar-back')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeDefined();

    // A screen may name its own way back.
    draw(<AppBar variant="screen" title="Settings" onBack={onBack} backLabel="Back to Profile" />);
    expect(screen.getByRole('button', { name: 'Back to Profile' })).toBe(
      screen.getByTestId('shell.app-bar-back'),
    );
    draw(<AppBar variant="screen" title="Settings" onBack={onBack} action={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('screen keeps the title centered between two slots of one width', () => {
    setViewport(...COMPACT);
    for (const state of ['screen', 'screenNoBack', 'screenAction', 'screenLongTitle'] as const) {
      const bar = barOf(drawState(state));
      const [left, middle, right, ...more] = [...bar.children];
      expect(more, state).toHaveLength(0);
      for (const slot of [left, right]) {
        expect(slot instanceof HTMLElement ? slot.style.width : null, state).toBe(
          `${String(size.target)}px`,
        );
      }
      expect(middle instanceof HTMLElement ? middle.style.flexGrow : null, state).toBe('1');
      expect(screen.getByRole('heading').style.textAlign, state).toBe('center');
      expect(bar.style.paddingLeft, state).toBe(`${String(space.x1)}px`);
      expect(bar.style.paddingRight, state).toBe(`${String(space.x1)}px`);
      expect(bar.style.zIndex, state).toBe(String(z.sticky));
    }
  });

  it('screen cuts a long title to one line', () => {
    setViewport(...COMPACT);
    drawState('screenLongTitle');
    const title = screen.getByRole('heading', { name: STATES.screenLongTitle.title });
    const drawn = window.getComputedStyle(title);
    expect(drawn.whiteSpace).toBe('nowrap');
    expect(drawn.textOverflow).toBe('ellipsis');
    expect(drawn.overflow).toBe('hidden');
  });

  it('screen moves focus to its title when it appears', () => {
    setViewport(...COMPACT);
    drawState('screen');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Settings' }));
    // The title is reached from code only: it is not a stop of the Tab key.
    expect(screen.getByRole('heading').getAttribute('tabindex')).toBe('-1');
  });

  it('screen draws what it is given in place of the title', () => {
    setViewport(...COMPACT);
    draw(
      <AppBar
        variant="screen"
        title="Settings"
        onBack={null}
        center={<Text role="body">Step 2 of 4</Text>}
      />,
    );
    expect(screen.getByText('Step 2 of 4')).toBeDefined();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();

    // A screen with no title and nothing in its place still draws its two slots.
    const bar = barOf(draw(<AppBar variant="screen" title={null} onBack={null} />));
    expect(bar.children).toHaveLength(3);
    expect(bar.textContent).toBe('');
  });

  it('fills the top inset with its own ground', () => {
    setViewport(...COMPACT);
    const props: readonly AppBarProps[] = [STATES.homeUnread, STATES.screen];
    for (const state of props) {
      const bar = barOf(drawOnPhone(<AppBar {...state} />));
      expect(bar.style.paddingTop, state.variant).toBe(`${String(PHONE_INSETS.top)}px`);
      expect(bar.style.minHeight, state.variant).toBe(
        `${String(size.appBar + PHONE_INSETS.top)}px`,
      );
      expect(bar.style.backgroundColor, state.variant).toBe(written(color.light.bg));
    }
  });

  it('the inset cover draws nothing without an inset', () => {
    // What the test's own providers draw around nothing at all.
    const empty = draw(<></>).innerHTML;
    expect(draw(<AppBarInsetCover />).innerHTML).toBe(empty);

    // With an inset it covers the status bar's height, over the content and out of a reader's way.
    const container = drawOnPhone(<AppBarInsetCover />);
    const cover = container.querySelector<HTMLElement>('[style*="position: absolute"]');
    expect(cover?.style.height).toBe(`${String(PHONE_INSETS.top)}px`);
    expect(cover?.style.top).toBe('0px');
    expect(cover?.style.left).toBe('0px');
    expect(cover?.style.right).toBe('0px');
    expect(cover?.style.backgroundColor).toBe(written(color.light.bg));
    expect(cover?.style.zIndex).toBe(String(z.sticky));
    expect(cover?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[role], [tabindex]')).toHaveLength(0);
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const container = drawState(state);
      for (const control of container.querySelectorAll<HTMLElement>('[data-testid]')) {
        expect(control.getAttribute('role') ?? control.tagName.toLowerCase(), state).toBe('button');
        expect(control.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    const expected: Record<StateName, string[]> = {
      homeNoMessages: [],
      homeMessages: ['shell.app-bar-messages'],
      homeUnread: ['shell.app-bar-messages'],
      screen: ['shell.app-bar-back'],
      screenNoBack: [],
      screenAction: ['shell.app-bar-back', 'gallery.app-bar-action'],
      screenLongTitle: ['shell.app-bar-back'],
    };
    for (const state of STATE_NAMES) {
      const container = drawState(state);
      const ids = [...container.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(expected[state]);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
      // Every control is a full target.
      for (const control of container.querySelectorAll<HTMLElement>('[data-testid]')) {
        expect(control.parentElement?.style.width, state).toBe(`${String(size.target)}px`);
        expect(control.parentElement?.style.height, state).toBe(`${String(size.target)}px`);
      }
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    drawState('screenAction', { reducedMotion: true });
    for (const id of ['shell.app-bar-back', 'gallery.app-bar-action']) {
      const control = screen.getByTestId(id);
      fireEvent.keyDown(control, { key: 'Enter' });
      for (const part of [control, ...control.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, id).toContain(part.style.transform);
      }
      fireEvent.keyUp(control, { key: 'Enter' });
    }
    // The same press moves the button where motion is allowed; the bar itself never animates.
    const container = drawState('screenAction');
    const back = screen.getByTestId('shell.app-bar-back');
    fireEvent.keyDown(back, { key: 'Enter' });
    expect(
      [...back.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
    ).toContain(MOVED);
    fireEvent.keyUp(back, { key: 'Enter' });
    for (const part of container.querySelectorAll<HTMLElement>('*')) {
      expect(part.style.animationName).toBe('');
    }
  });
});
