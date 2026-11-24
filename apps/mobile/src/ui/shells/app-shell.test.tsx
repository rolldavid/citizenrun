import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import type { ComponentType, JSX, ReactElement } from 'react';
import { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { Text } from '@/ui/components/text';
import { color, size } from '@/ui/tokens';

import { AppShell, ShellLayout, useShell } from './app-shell';
import type { AppShellProps, ShellContextValue } from './app-shell';
import { GROUND, PREVIEW, STATES } from './app-shell.fixtures';
import { CompactShell } from './compact-shell';
import { ExpandedShell } from './expanded-shell';
import { MediumShell } from './medium-shell';
import { subscribeReselect } from './reselect';
import { layoutFor, useBreakpoint } from './use-breakpoint';

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

const STATE_NAMES = ['signedOutHome', 'signedInUnread', 'noActive', 'bare'] as const;

const SHELLS: readonly { name: string; Shell: ComponentType<AppShellProps> }[] = [
  { name: 'AppShell', Shell: AppShell },
  { name: 'CompactShell', Shell: CompactShell },
  { name: 'MediumShell', Shell: MediumShell },
  { name: 'ExpandedShell', Shell: ExpandedShell },
];

const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

const content = <Text role="body">Content</Text>;

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

/** Renders C-AppShell around the placeholder, signed out on Home unless a prop says otherwise. */
function drawShell(
  props: Partial<AppShellProps> = {},
  options: RenderWithProvidersOptions = {},
): void {
  draw(
    <AppShell {...STATES.signedOutHome} {...props}>
      {props.children ?? content}
    </AppShell>,
    options,
  );
}

/** What the keyboard can reach, in the order of the document. */
function focusables(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    ),
  ].filter((element) => element.tabIndex >= 0);
}

/** The press targets of the rail, in the order they are drawn. */
function railItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="shell.rail-"]')];
}

function Mounted({ onMount }: { onMount: () => void }): JSX.Element {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return content;
}

function ShellProbe({ onRead }: { onRead: (value: ShellContextValue) => void }): null {
  const shell = useShell();
  useEffect(() => {
    onRead(shell);
  }, [onRead, shell]);
  return null;
}

/** Draws the width of the canvas, the one value of the layout the top bar's height changes. */
function CanvasProbe(): JSX.Element {
  const { canvasWidth } = useBreakpoint();
  return (
    <Text role="body" testID="probe.canvas">
      {String(canvasWidth)}
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
});

describe('AppShell', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const [width, height] of [COMPACT, MEDIUM, EXPANDED]) {
      setViewport(width, height);
      for (const theme of ['light', 'dark'] as const) {
        for (const { name, Shell } of SHELLS) {
          for (const state of STATE_NAMES) {
            draw(<Shell {...STATES[state]}>{content}</Shell>, { theme });
            expect(screen.getByText('Content'), `${name} ${state}`).toBeDefined();
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the four states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.signedOutHome).toMatchObject({
      mode: 'app',
      active: 'home',
      unread: { messages: 0, activity: 0 },
      place: null,
      topBar: null,
      banner: null,
      signedIn: false,
    });
    expect(STATES.signedInUnread).toMatchObject({
      signedIn: true,
      unread: { messages: 3, activity: 12 },
      place: { name: 'Wren County', districtCount: 14, officeCount: 38 },
    });
    expect(STATES.noActive.active).toBeNull();
    expect(STATES.bare.mode).toBe('bare');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('picks the layout for the breakpoint', () => {
    setViewport(...COMPACT);
    drawShell();
    expect(screen.queryByTestId('shell.rail')).toBeNull();
    expect(screen.getByText('Content')).toBeDefined();

    // The icons rail names its items for a screen reader and shows no word.
    setViewport(...MEDIUM);
    drawShell();
    const icons = screen.getByTestId('shell.rail');
    expect(within(icons).queryByText('Home')).toBeNull();
    expect(within(icons).getByRole('link', { name: 'Home' })).toBeDefined();
    expect(icons.style.width).toBe(`${String(size.railIcon)}px`);

    setViewport(...EXPANDED);
    drawShell();
    const labeled = screen.getByTestId('shell.rail');
    expect(within(labeled).getByText('Home')).toBeDefined();
    expect(labeled.style.width).toBe(`${String(size.rail)}px`);
  });

  it('never remounts its children when the breakpoint changes', () => {
    const onMount = vi.fn();
    setViewport(...EXPANDED);
    drawShell({ children: <Mounted onMount={onMount} /> });
    const child = screen.getByText('Content');
    const seen: (string | null)[] = [];
    const rail = (): string | null => screen.queryByTestId('shell.rail')?.style.width ?? null;
    seen.push(rail());
    for (const [width, height] of [MEDIUM, COMPACT, EXPANDED]) {
      setViewport(width, height);
      seen.push(rail());
      // The same element stays in the page through every change of chrome.
      expect(screen.getByText('Content')).toBe(child);
    }
    expect(seen).toEqual([
      `${String(size.rail)}px`,
      `${String(size.railIcon)}px`,
      null,
      `${String(size.rail)}px`,
    ]);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('app mode has one main and one navigation landmark', () => {
    setViewport(...EXPANDED);
    drawShell();
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]?.contains(screen.getByText('Content'))).toBe(true);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBe(screen.getByTestId('shell.rail'));
    // The rail is beside the content, not inside it.
    expect(mains[0]?.contains(screen.getByTestId('shell.rail'))).toBe(false);

    // At compact the content is still the page's main, and no navigation is drawn by the shell.
    setViewport(...COMPACT);
    drawShell();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('bare mode draws no chrome', () => {
    setViewport(...EXPANDED);
    draw(<AppShell {...STATES.bare}>{content}</AppShell>);
    expect(screen.queryByTestId('shell.rail')).toBeNull();
    expect(screen.queryByTestId('shell.skip-link')).toBeNull();
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(focusables()).toEqual([]);
    expect(screen.getByText('Content')).toBeDefined();
  });

  it('the skip link is first and moves focus to the content', () => {
    setViewport(...EXPANDED);
    drawShell();
    const skip = screen.getByTestId('shell.skip-link');
    expect(focusables()[0]).toBe(skip);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBe(skip);

    fireEvent.click(skip);
    expect(document.activeElement).toBe(screen.getByRole('main'));

    // At compact it is still the first thing the keyboard reaches.
    setViewport(...COMPACT);
    drawShell();
    expect(focusables()[0]).toBe(screen.getByTestId('shell.skip-link'));
  });

  it('the skip link shows only while it has focus', () => {
    setViewport(...EXPANDED);
    drawShell({}, { theme: 'light' });
    const skip = screen.getByTestId('shell.skip-link');
    const box = (): HTMLElement => {
      const element = skip.firstElementChild;
      if (!(element instanceof HTMLElement)) {
        throw new Error('the skip link has no box');
      }
      return element;
    };
    // Hidden: clear, out of the flow and closed to the pointer, so it covers nothing.
    expect(box().style.opacity).toBe('0');
    expect(box().style.position).toBe('absolute');
    expect(window.getComputedStyle(box()).pointerEvents).toBe('none');
    expect(within(skip).getByText('Skip to content')).toBeDefined();

    act(() => {
      skip.focus();
    });
    expect(box().style.opacity).toBe('');
    expect(box().style.position).not.toBe('absolute');
    expect(window.getComputedStyle(box()).pointerEvents).not.toBe('none');
    expect(box().style.backgroundColor).toBe(written(color.light.bg));
    expect(skip.style.outlineStyle).toBe('solid');

    act(() => {
      skip.blur();
    });
    expect(box().style.opacity).toBe('0');
  });

  it('choosing another item navigates', () => {
    const onNavigate = vi.fn();
    const onReselect = vi.fn();
    setViewport(...EXPANDED);
    drawShell({ onNavigate, onReselect });
    fireEvent.click(screen.getByTestId('shell.rail-explore'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('explore');
    expect(onReselect).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
  });

  it('choosing the active item reselects', () => {
    const onNavigate = vi.fn();
    const onReselect = vi.fn();
    const home = vi.fn();
    const explore = vi.fn();
    const stopHome = subscribeReselect('home', home);
    const stopExplore = subscribeReselect('explore', explore);
    setViewport(...EXPANDED);
    drawShell({ active: 'home', onNavigate, onReselect });
    fireEvent.click(screen.getByTestId('shell.rail-home'));
    expect(onReselect).toHaveBeenCalledTimes(1);
    expect(onReselect).toHaveBeenCalledWith('home');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    expect(home).toHaveBeenCalledTimes(1);
    expect(explore).not.toHaveBeenCalled();
    // The signal goes out before the route is told.
    expect(home.mock.invocationCallOrder[0]).toBeLessThan(
      onReselect.mock.invocationCallOrder[0] ?? 0,
    );
    stopHome();
    stopExplore();
  });

  it('the shell context carries the banner and the active item', () => {
    const banner = <View testID="probe.banner" />;
    const seen: ShellContextValue[] = [];
    const onRead = (value: ShellContextValue): void => {
      seen.push(value);
    };
    setViewport(...EXPANDED);
    drawShell({ active: 'home', banner, children: <ShellProbe onRead={onRead} /> });
    expect(seen.at(-1)).toEqual({ banner, mainProvided: true, active: 'home' });
    expect(seen.at(-1)?.banner).toBe(banner);
    // The shell hands the banner on and does not draw it itself.
    expect(screen.queryByTestId('probe.banner')).toBeNull();

    draw(
      <AppShell {...STATES.bare}>
        <ShellProbe onRead={onRead} />
      </AppShell>,
    );
    expect(seen.at(-1)).toEqual({ banner: null, mainProvided: false, active: null });

    seen.length = 0;
    draw(<ShellProbe onRead={onRead} />);
    expect(seen.at(-1)).toEqual({ banner: null, mainProvided: false, active: null });
  });

  it('the named layouts ignore the window', () => {
    setViewport(...EXPANDED);
    draw(<CompactShell {...STATES.signedOutHome}>{content}</CompactShell>);
    expect(screen.queryByTestId('shell.rail')).toBeNull();

    setViewport(...COMPACT);
    draw(<MediumShell {...STATES.signedOutHome}>{content}</MediumShell>);
    const icons = screen.getByTestId('shell.rail');
    expect(icons.style.width).toBe(`${String(size.railIcon)}px`);
    expect(within(icons).queryByText('Home')).toBeNull();

    draw(<ExpandedShell {...STATES.signedOutHome}>{content}</ExpandedShell>);
    const labeled = screen.getByTestId('shell.rail');
    expect(labeled.style.width).toBe(`${String(size.rail)}px`);
    expect(within(labeled).getByText('Home')).toBeDefined();
  });

  it('supplies the top bar height', () => {
    // The layout carries the height in the canvas it leaves at expanded: the taller the bar, the narrower the canvas.
    const [width, height] = EXPANDED;
    const under = (topBarHeight: number): string =>
      String(layoutFor({ width, height, fontScale: 1, topBarHeight }).canvasWidth);
    expect(under(size.getAppBar)).not.toBe(under(0));
    const canvas = (): string | null => screen.getByTestId('probe.canvas').textContent;

    setViewport(width, height);
    drawShell({ topBar: <View testID="probe.top-bar" />, children: <CanvasProbe /> });
    expect(canvas()).toBe(under(size.getAppBar));
    // The bar sits in a box of its own height above the row.
    expect(screen.getByTestId('probe.top-bar').parentElement?.style.height).toBe(
      `${String(size.getAppBar)}px`,
    );

    drawShell({ topBar: null, children: <CanvasProbe /> });
    expect(canvas()).toBe(under(0));

    draw(
      <AppShell {...STATES.bare} topBar={<View />}>
        <CanvasProbe />
      </AppShell>,
    );
    expect(canvas()).toBe(under(size.getAppBar));

    draw(<CanvasProbe />);
    expect(canvas()).toBe(under(0));
  });

  it('a change of top bar never remounts its children', () => {
    const onMount = vi.fn();
    setViewport(...EXPANDED);
    cleanup();
    const view = renderWithProviders(
      <AppShell {...STATES.signedOutHome} topBar={null}>
        <Mounted onMount={onMount} />
      </AppShell>,
    );
    view.rerender(
      <AppShell {...STATES.signedOutHome} topBar={<View />}>
        <Mounted onMount={onMount} />
      </AppShell>,
    );
    view.rerender(
      <AppShell {...STATES.signedOutHome} topBar={null}>
        <Mounted onMount={onMount} />
      </AppShell>,
    );
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('caps the expanded row at the content width and centers it', () => {
    draw(
      <ShellLayout {...STATES.signedOutHome} breakpoint="expanded">
        {content}
      </ShellLayout>,
    );
    const row = screen.getByTestId('shell.rail').parentElement;
    expect(row?.style.maxWidth).toBe(`${String(size.contentMax)}px`);
    expect(row?.style.alignSelf).toBe('center');
    expect(row?.style.flexDirection).toBe('row');

    draw(
      <ShellLayout {...STATES.signedOutHome} breakpoint="medium">
        {content}
      </ShellLayout>,
    );
    expect(screen.getByTestId('shell.rail').parentElement?.style.maxWidth).toBe('');
  });

  it('has a label and a role', () => {
    setViewport(...EXPANDED);
    drawShell({ ...STATES.signedInUnread });
    const names = focusables().map((element) => element.getAttribute('aria-label'));
    expect(names).toEqual([
      'Skip to content',
      'Home',
      'Explore',
      'Post',
      'Activity, 12 unread',
      'Messages, 3 unread',
      'Profile',
    ]);
    for (const element of focusables()) {
      expect(['link', 'button'], element.getAttribute('aria-label') ?? '').toContain(
        element.getAttribute('role') ?? element.tagName.toLowerCase(),
      );
    }
  });

  it('has a testID', () => {
    setViewport(...EXPANDED);
    drawShell();
    const ids = focusables().map((element) => element.getAttribute('data-testid'));
    expect(ids).toEqual([
      'shell.skip-link',
      'shell.rail-home',
      'shell.rail-explore',
      'shell.rail-post',
      'shell.rail-activity',
      'shell.rail-messages',
      'shell.rail-profile',
    ]);
    for (const id of ids) {
      expect(id).toMatch(TEST_ID);
    }
  });

  it('respects reduced motion', () => {
    setViewport(...EXPANDED);
    drawShell({}, { reducedMotion: true });
    const reduced = screen.getByTestId('shell.rail-explore');
    fireEvent.keyDown(reduced, { key: 'Enter' });
    for (const part of [reduced, ...reduced.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    fireEvent.keyUp(reduced, { key: 'Enter' });

    // The same press moves the item where motion is allowed, and the chrome itself never animates.
    drawShell();
    const moving = screen.getByTestId('shell.rail-explore');
    fireEvent.keyDown(moving, { key: 'Enter' });
    expect(
      [...moving.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
    ).toContain(MOVED);
    fireEvent.keyUp(moving, { key: 'Enter' });
    expect(railItems()).toHaveLength(6);
    for (const part of screen.getByTestId('shell.rail').querySelectorAll<HTMLElement>('*')) {
      expect(part.style.animationName).toBe('');
    }
  });
});
