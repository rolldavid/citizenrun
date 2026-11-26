import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import type { JSX, ReactElement } from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { SCREEN_FIXTURES } from '@/features/dev';
import * as fixtures from '@/features/system/view-models/root.fixtures';
import type { NavItem, RootViewModel } from '@/features/system/view-models/root.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { Screen } from '@/ui/components/screen';

import { RootLayoutScreenView, useRootNav } from './root-layout-screen';

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

const FIXTURE_NAMES = [
  'rootStarting',
  'rootSignedOut',
  'rootSignedIn',
  'rootUpdate',
  'rootAdultsOnly',
  'rootAgreements',
] as const;

const HOME_TITLE = 'Your feed starts here.';

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

type Viewport = readonly [width: number, height: number];

function sized(viewport: Viewport): void {
  setViewport(viewport[0], viewport[1]);
}

/** One fixture as the registry draws it: the layout around Home, with the system screen it names. */
function fixtureElement(name: (typeof FIXTURE_NAMES)[number]): ReactElement {
  const drawn = SCREEN_FIXTURES['root-layout']?.render(name) ?? null;
  if (drawn === null) {
    throw new Error(`the registry holds no root layout fixture ${name}`);
  }
  return drawn;
}

/** Renders one fixture, in place of whatever was drawn before. */
function draw(
  name: (typeof FIXTURE_NAMES)[number],
  options: RenderWithProvidersOptions = {},
): HTMLElement {
  cleanup();
  return renderWithProviders(fixtureElement(name), options).container;
}

/** A probe for the system screen that takes the navigator's place, while the view-model names one. */
function systemProbe(vm: RootViewModel): ReactElement | null {
  return vm.system === 'update' || vm.system === 'adultsOnly' ? (
    <View testID="probe.system" />
  ) : null;
}

/** The layout around two probes: one stands for the root stack, the other for a system screen. */
function probed(vm: RootViewModel): JSX.Element {
  return (
    <RootLayoutScreenView vm={vm} systemScreen={systemProbe(vm)} overlay={null}>
      <View testID="probe.stack" />
    </RootLayoutScreenView>
  );
}

/** Stands for what a screen holds: it tells each time it mounts. */
function Held({ onMount }: { onMount: () => void }): JSX.Element {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <View testID="probe.held" />;
}

/** The layout around a screen of the app in place of the root stack, and a probe for a system screen. */
function aroundScreen(vm: RootViewModel, onMount: () => void): JSX.Element {
  return (
    <RootLayoutScreenView vm={vm} systemScreen={systemProbe(vm)} overlay={null}>
      <Screen testID="probe.screen">
        <Held onMount={onMount} />
      </Screen>
    </RootLayoutScreenView>
  );
}

/** Stands for the tab navigator's bar: it shows what the root layout hands it, and uses it. */
function NavProbe(): JSX.Element {
  const nav = useRootNav();
  return (
    <View
      testID="probe.nav"
      onClick={() => {
        nav.onNavigate('profile');
        nav.onReselect('home');
      }}
    >
      <View testID="probe.nav-active">{nav.active}</View>
      <View testID="probe.nav-activity">{nav.unreadActivity}</View>
    </View>
  );
}

/** The box the layout keeps the stack in. */
function stackBox(probe: HTMLElement): HTMLElement {
  const box = probe.parentElement;
  if (box === null) {
    throw new Error('the stack has no box');
  }
  return box;
}

describe('RootLayoutScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(fixtures).sort()).toEqual([...FIXTURE_NAMES].sort());
    for (const viewport of [NARROW, COMPACT, MEDIUM, EXPANDED]) {
      sized(viewport);
      for (const name of FIXTURE_NAMES) {
        for (const theme of ['light', 'dark'] as const) {
          const container = draw(name, { theme });
          expect(container.textContent).not.toContain('{{');
          expect(screen.queryAllByRole('main').length).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('draws the shell for the breakpoint', () => {
    sized(COMPACT);
    draw('rootSignedOut');
    expect(screen.queryByTestId('shell.rail')).toBeNull();
    expect(screen.getByTestId('feed.home')).toBeTruthy();

    sized(MEDIUM);
    draw('rootSignedOut');
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    // The icon rail shows no label.
    expect(screen.getByTestId('shell.rail-home').textContent).toBe('');

    sized(EXPANDED);
    draw('rootSignedOut');
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    const home = screen.getByTestId('shell.rail-home');
    expect(home.textContent).toBe('Home');
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('shell.rail-explore').getAttribute('aria-current')).toBeNull();
    // One page: the shell's slot is the main landmark, and the screen's title its one heading.
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('main').contains(screen.getByTestId('feed.home'))).toBe(true);
  });

  it('starting draws the shell and no screen', () => {
    sized(EXPANDED);
    draw('rootStarting');
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    expect(screen.queryByTestId('feed.home')).toBeNull();
    expect(screen.queryByTestId('system.update')).toBeNull();
    expect(screen.getByRole('main').textContent).toBe('');

    sized(COMPACT);
    draw('rootStarting');
    expect(screen.queryByTestId('feed.home')).toBeNull();
  });

  it('the update screen covers a hidden stack', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      sized(viewport);
      draw('rootUpdate');
      const update = screen.getByTestId('system.update');
      expect(screen.queryByTestId('shell.rail')).toBeNull();
      expect(screen.queryByTestId('shell.skip-link')).toBeNull();
      // The stack is still there, out of reach.
      const stack = stackBox(screen.getByTestId('feed.home'));
      expect(stack.getAttribute('aria-hidden')).toBe('true');
      expect(window.getComputedStyle(stack).pointerEvents).toBe('none');
      expect(stack.contains(update)).toBe(false);
      expect(update.closest('[aria-hidden="true"]')).toBeNull();
      // A screen reader finds the update screen's title and nothing of the screen under it.
      expect(screen.getAllByRole('heading', { level: 1 })).toEqual([
        update.querySelector('[role="heading"], h1'),
      ]);
      expect(screen.queryByRole('heading', { name: HOME_TITLE })).toBeNull();
    }
  });

  it('adults-only covers the stack', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      sized(viewport);
      draw('rootAdultsOnly');
      const adultsOnly = screen.getByTestId('system.adults-only');
      expect(adultsOnly.textContent).toContain('This app is for adults.');
      expect(screen.queryByTestId('shell.rail')).toBeNull();
      // Home is still there under it, out of reach of touch and of a screen reader.
      const stack = stackBox(screen.getByTestId('feed.home'));
      expect(stack.getAttribute('aria-hidden')).toBe('true');
      expect(window.getComputedStyle(stack).pointerEvents).toBe('none');
      expect(stack.contains(adultsOnly)).toBe(false);
      expect(adultsOnly.closest('[aria-hidden="true"]')).toBeNull();
      expect(
        screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent),
      ).toEqual(['This app is for adults.']);
      expect(screen.queryByTestId('system.agreements')).toBeNull();
    }
  });

  it('agreements over a visible stack', () => {
    sized(EXPANDED);
    draw('rootAgreements');
    const sheet = screen.getByTestId('system.agreements');
    expect(sheet.textContent).toContain('We updated our terms.');
    const home = screen.getByTestId('feed.home');
    expect(within(home).getByText(HOME_TITLE)).toBeTruthy();
    // The stack keeps its place and its chrome: the sheet is modal by itself.
    const stack = stackBox(home);
    expect(stack.getAttribute('aria-hidden')).not.toBe('true');
    expect(window.getComputedStyle(stack).pointerEvents).not.toBe('none');
    expect(stack.contains(sheet)).toBe(false);
    expect(home.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    expect(screen.getByTestId('shell.rail-home').getAttribute('aria-current')).toBe('page');
    expect(screen.queryByTestId('system.adults-only')).toBeNull();
    expect(screen.queryByTestId('system.update')).toBeNull();

    sized(COMPACT);
    draw('rootAgreements');
    expect(screen.getByTestId('system.agreements')).toBeTruthy();
    expect(stackBox(screen.getByTestId('feed.home')).getAttribute('aria-hidden')).not.toBe('true');
  });

  it('draws what it is handed and nothing of its own choosing', () => {
    sized(EXPANDED);
    cleanup();
    // The view-model names the agreements; the layout draws only the overlay it is given.
    const view = renderWithProviders(
      <RootLayoutScreenView vm={fixtures.rootAgreements} systemScreen={null} overlay={null}>
        <View testID="probe.stack" />
      </RootLayoutScreenView>,
    );
    const stack = screen.getByTestId('probe.stack');
    expect(stackBox(stack).nextElementSibling).toBeNull();
    expect(screen.getByTestId('shell.rail')).toBeTruthy();

    view.rerender(
      <RootLayoutScreenView
        vm={fixtures.rootAgreements}
        systemScreen={null}
        overlay={<View testID="probe.overlay" />}
      >
        <View testID="probe.stack" />
      </RootLayoutScreenView>,
    );
    // After the stack, with no cover around it, and the stack is the one that was there.
    expect(stackBox(screen.getByTestId('probe.stack')).nextElementSibling).toBe(
      screen.getByTestId('probe.overlay'),
    );
    expect(screen.getByTestId('probe.stack')).toBe(stack);
    expect(stackBox(stack).getAttribute('aria-hidden')).not.toBe('true');
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
  });

  it('the tab values reach the provider', () => {
    sized(COMPACT);
    const chosen: string[] = [];
    const vm: RootViewModel = {
      ...fixtures.rootSignedIn,
      shell: { ...fixtures.rootSignedIn.shell, unread: { messages: 0, activity: 3 } },
      onNavigate: (item: NavItem) => chosen.push(`navigate ${item}`),
      onReselect: (item: NavItem) => chosen.push(`reselect ${item}`),
    };
    cleanup();
    const view = renderWithProviders(
      <RootLayoutScreenView vm={vm} systemScreen={null} overlay={null}>
        <NavProbe />
      </RootLayoutScreenView>,
    );
    expect(screen.getByTestId('probe.nav-active').textContent).toBe(
      fixtures.rootSignedIn.shell.active,
    );
    expect(screen.getByTestId('probe.nav-activity').textContent).toBe('3');
    fireEvent.click(screen.getByTestId('probe.nav'));
    expect(chosen).toEqual(['navigate profile', 'reselect home']);

    // A pushed route with no tab under it has no active item, and the count follows the view-model.
    view.rerender(
      <RootLayoutScreenView
        vm={{ ...vm, shell: { ...vm.shell, active: null, unread: { messages: 0, activity: 0 } } }}
        systemScreen={null}
        overlay={null}
      >
        <NavProbe />
      </RootLayoutScreenView>,
    );
    expect(screen.getByTestId('probe.nav-active').textContent).toBe('');
    expect(screen.getByTestId('probe.nav-activity').textContent).toBe('0');
  });

  it('the tab values are read inside the root layout only', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup();
    expect(() => renderWithProviders(<NavProbe />)).toThrow(
      'useRootNav is read outside the root layout',
    );
    logged.mockRestore();
  });

  it('the stack stays mounted under a system screen that comes and goes', () => {
    sized(EXPANDED);
    // A route that has no chrome of its own, so the shell around the stack is the same throughout.
    const bare: RootViewModel = {
      ...fixtures.rootSignedOut,
      shell: { ...fixtures.rootSignedOut.shell, mode: 'bare', active: null },
    };
    cleanup();
    const view = renderWithProviders(probed(bare));
    const stack = screen.getByTestId('probe.stack');
    expect(stackBox(stack).getAttribute('aria-hidden')).not.toBe('true');
    expect(window.getComputedStyle(stackBox(stack)).pointerEvents).not.toBe('none');
    expect(screen.queryByTestId('probe.system')).toBeNull();

    view.rerender(probed({ ...bare, system: 'update' }));
    expect(screen.getByTestId('probe.stack')).toBe(stack);
    expect(stackBox(stack).getAttribute('aria-hidden')).toBe('true');
    expect(window.getComputedStyle(stackBox(stack)).pointerEvents).toBe('none');
    expect(screen.getByTestId('probe.system')).toBeTruthy();

    view.rerender(probed(bare));
    expect(screen.getByTestId('probe.stack')).toBe(stack);
    expect(stackBox(stack).getAttribute('aria-hidden')).not.toBe('true');
    expect(window.getComputedStyle(stackBox(stack)).pointerEvents).not.toBe('none');
    expect(screen.queryByTestId('probe.system')).toBeNull();
  });

  it('an app route under a system screen loses its chrome and gets it back', () => {
    sized(EXPANDED);
    cleanup();
    const view = renderWithProviders(probed(fixtures.rootSignedOut));
    const stack = screen.getByTestId('probe.stack');
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    view.rerender(probed(fixtures.rootUpdate));
    expect(screen.queryByTestId('shell.rail')).toBeNull();
    expect(screen.getByTestId('probe.system')).toBeTruthy();
    expect(screen.getByTestId('probe.stack')).toBeTruthy();
    // The chrome goes and the stack is the one that was there.
    expect(screen.getByTestId('probe.stack')).toBe(stack);
    view.rerender(probed(fixtures.rootSignedOut));
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    expect(screen.queryByTestId('probe.system')).toBeNull();
    expect(screen.getByTestId('probe.stack')).toBeTruthy();
    expect(screen.getByTestId('probe.stack')).toBe(stack);
  });

  it('a screen of an app route stays mounted under a system screen that comes and goes', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      sized(viewport);
      const onMount = vi.fn();
      const open = fixtures.rootSignedOut;
      // The route under the cover is still a route of the app: only the system screen changes.
      const covered: RootViewModel = { ...open, system: 'update' };
      cleanup();
      const view = renderWithProviders(aroundScreen(open, onMount));
      const held = screen.getByTestId('probe.held');
      const area = screen.getByTestId('probe.screen-scroll');
      const slot = screen.getByRole('main');
      expect(slot.contains(held)).toBe(true);
      expect(screen.getByTestId('shell.skip-link')).toBeTruthy();

      view.rerender(aroundScreen(covered, onMount));
      expect(screen.getByTestId('probe.system')).toBeTruthy();
      expect(screen.queryByTestId('shell.skip-link')).toBeNull();
      expect(screen.getByTestId('probe.held')).toBe(held);
      expect(screen.getByTestId('probe.screen-scroll')).toBe(area);
      expect(slot.contains(held)).toBe(true);
      // The covered screen is out of a screen reader's reach, its landmark with it.
      expect(stackBox(screen.getByTestId('probe.screen')).getAttribute('aria-hidden')).toBe('true');
      expect(screen.queryByRole('main')).toBeNull();

      view.rerender(aroundScreen(open, onMount));
      expect(screen.queryByTestId('probe.system')).toBeNull();
      expect(screen.getAllByRole('main')).toEqual([slot]);
      expect(screen.getByTestId('probe.held')).toBe(held);
      expect(screen.getByTestId('probe.screen-scroll')).toBe(area);
      expect(onMount).toHaveBeenCalledTimes(1);
    }
  });

  it('the stack mounts when the app has started, and a change of width keeps it', () => {
    sized(EXPANDED);
    cleanup();
    const view = renderWithProviders(probed(fixtures.rootStarting));
    expect(screen.queryByTestId('probe.stack')).toBeNull();
    view.rerender(probed(fixtures.rootSignedOut));
    const stack = screen.getByTestId('probe.stack');
    sized(MEDIUM);
    sized(COMPACT);
    expect(screen.getByTestId('probe.stack')).toBe(stack);
  });

  it('the system screen fills the slot on the ground of the theme, above the stack', () => {
    sized(COMPACT);
    cleanup();
    renderWithProviders(probed(fixtures.rootUpdate));
    const cover = screen.getByTestId('probe.system').parentElement;
    expect(cover?.style.position).toBe('absolute');
    expect([cover?.style.top, cover?.style.right, cover?.style.bottom, cover?.style.left]).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ]);
    expect(cover?.style.backgroundColor).not.toBe('');
    expect(Number(cover?.style.zIndex)).toBeGreaterThan(0);
    // It comes after the stack, so it is what a reader meets.
    const stack = stackBox(screen.getByTestId('probe.stack'));
    expect(stack.nextElementSibling).toBe(cover);
  });

  it('hands a choice in the rail to the view-model', () => {
    sized(EXPANDED);
    const chosen: string[] = [];
    const vm: RootViewModel = {
      ...fixtures.rootSignedOut,
      onNavigate: (item: NavItem) => chosen.push(`navigate ${item}`),
      onReselect: (item: NavItem) => chosen.push(`reselect ${item}`),
    };
    cleanup();
    renderWithProviders(probed(vm));
    fireEvent.click(screen.getByTestId('shell.rail-explore'));
    fireEvent.click(screen.getByTestId('shell.rail-home'));
    expect(chosen).toEqual(['navigate explore', 'reselect home']);
  });
});
