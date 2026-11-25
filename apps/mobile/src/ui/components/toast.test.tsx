import { act, cleanup, screen, within } from '@testing-library/react';
import type { JSX } from 'react';
import { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { AppShell } from '@/ui/shells/app-shell';
import { clearBottomChrome, reportBottomChrome } from '@/ui/shells/bottom-chrome';
import { clearSideChrome, reportSideChrome } from '@/ui/shells/side-chrome';
import { color, gutter, radius, size, space, z } from '@/ui/tokens';

import { Dialog } from './dialog';
import type { InteractionPreviewState } from './pressable';
import { Sheet } from './sheet';
import { showToast, ToastHost } from './toast';
import { GROUND, PREVIEW, STATES } from './toast.fixtures';

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
type ToastInput = Parameters<typeof showToast>[0];

const STATE_NAMES = ['success', 'warning', 'error', 'longText'] as const;

const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

const PAGE = 'probe.page';
const OVERLAY = 'probe.overlay';
const WARNING_HAPTIC = { method: 'notify', kind: 'warning' };

// A haptic is dropped when it follows another too closely, so each case starts a minute after the last.
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  clock += 60_000;
  vi.setSystemTime(clock);
  setViewport(...COMPACT);
});

afterEach(() => {
  // The host goes before the clock does, so the toast's own timers are stopped by the host.
  cleanup();
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function Page(): JSX.Element {
  return (
    <ToastHost>
      <View testID={PAGE} />
    </ToastHost>
  );
}

/** Mounts the host around a page, in place of whatever was drawn before. */
function mount(options: RenderWithProvidersOptions = {}): void {
  cleanup();
  renderWithProviders(<Page />, options);
}

function show(input: ToastInput): void {
  act(() => {
    showToast(input);
  });
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function toasts(testID = 'toast'): HTMLElement[] {
  return screen.queryAllByTestId(testID);
}

/** The one toast showing now. */
function toast(testID = 'toast'): HTMLElement {
  return screen.getByTestId(testID);
}

/** The layer the host draws its toast in: the view after the page. */
function layer(): HTMLElement {
  const found = screen.getByTestId(PAGE).nextElementSibling;
  if (!(found instanceof HTMLElement)) {
    throw new Error('the host drew no layer');
  }
  return found;
}

/** The drawing of the toast's one icon. */
function iconOf(element: HTMLElement): string {
  const paths = element.querySelectorAll('svg path');
  expect(element.querySelectorAll('svg')).toHaveLength(1);
  return [...paths].map((path) => path.getAttribute('d') ?? '').join(' ');
}

describe('Toast', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      const icons = new Map<StateName, string>();
      for (const state of STATE_NAMES) {
        mount({ theme });
        show(STATES[state]);
        const element = toast();
        const name = `${state} ${theme}`;
        // Ink, with one icon that carries the kind: never a color and never a button.
        expect(element.style.backgroundColor, name).toBe(written(color[theme].inverseBg));
        expect(element.style.borderRadius, name).toBe(`${String(radius.control)}px`);
        expect(element.style.paddingTop, name).toBe(`${String(space.x3)}px`);
        expect(element.style.paddingBottom, name).toBe(`${String(space.x3)}px`);
        expect(element.style.paddingLeft, name).toBe(`${String(space.x4)}px`);
        expect(element.style.paddingRight, name).toBe(`${String(space.x4)}px`);
        expect(element.style.maxWidth, name).toBe(`${String(size.toastMax)}px`);
        expect(element.style.flexDirection, name).toBe('row');
        expect(element.style.boxShadow, name).toBe('');
        expect(element.style.opacity, name).toBe('1');
        const words = within(element).getByText(STATES[state].text);
        expect(words.style.color, name).toBe(written(color[theme].inverseText));
        expect(within(element).queryAllByRole('button'), name).toHaveLength(0);
        expect(within(element).queryAllByRole('link'), name).toHaveLength(0);
        const icon = iconOf(element);
        expect(icon, name).toMatch(/^M/);
        expect(element.querySelector('svg path')?.getAttribute('stroke'), name).toBe(
          color[theme].inverseText,
        );
        icons.set(state, icon);
      }
      // A check, a warning sign and an error sign; the long sentence is an error.
      expect(new Set(icons.values()).size, theme).toBe(3);
      expect(icons.get('longText'), theme).toBe(icons.get('error'));
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the four states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    const preview: Readonly<Partial<Record<StateName, InteractionPreviewState>>> = PREVIEW;
    expect(preview).toEqual({});
    expect(GROUND).toEqual({});
    expect(STATES.success).toEqual({ kind: 'success', text: 'Link copied' });
    expect(STATES.error).toEqual({
      kind: 'error',
      text: "Couldn't follow this office. Try again.",
    });
    expect(STATES.warning.kind).toBe('warning');
  });

  it('success is a polite status and error an assertive alert', () => {
    mount();
    show(STATES.success);
    expect(screen.getByRole('status')).toBe(toast());
    expect(toast().getAttribute('aria-live')).toBe('polite');
    show(STATES.error);
    expect(screen.getByRole('alert')).toBe(toast());
    expect(toast().getAttribute('aria-live')).toBe('assertive');
    show(STATES.warning);
    expect(screen.getByRole('alert')).toBe(toast());
    expect(toast().getAttribute('aria-live')).toBe('assertive');
  });

  it('an error or warning toast plays the warning haptic and success plays none', () => {
    mount();
    show(STATES.success);
    expect(hapticsFake.calls).toEqual([]);
    show(STATES.error);
    expect(hapticsFake.calls).toEqual([WARNING_HAPTIC]);
    wait(motion.duration.toastHold);
    show(STATES.warning);
    expect(hapticsFake.calls).toEqual([WARNING_HAPTIC, WARNING_HAPTIC]);
    wait(motion.duration.toastHold);
    show(STATES.success);
    expect(hapticsFake.calls).toEqual([WARNING_HAPTIC, WARNING_HAPTIC]);
  });

  it('holds four seconds and then fades out', () => {
    expect(motion.duration.toastHold).toBe(4000);
    for (const reducedMotion of [false, true]) {
      mount({ reducedMotion });
      show(STATES.success);
      // It cuts in: there at once, at full strength.
      expect(toast().style.opacity).toBe('1');
      expect(toast().style.transform).toBe('');
      wait(motion.duration.toastHold - 1);
      expect(toast().style.opacity).toBe('1');
      wait(1);
      expect(toast().style.opacity).toBe('0');
      wait(motion.duration.fade - 1);
      expect(toasts()).toHaveLength(1);
      wait(1);
      expect(toasts()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('a new toast replaces the one showing', () => {
    mount();
    show(STATES.success);
    wait(motion.duration.toastHold - 1);
    show(STATES.error);
    expect(toasts()).toHaveLength(1);
    expect(within(toast()).getByText(STATES.error.text)).toBeDefined();
    expect(screen.queryByText(STATES.success.text)).toBeNull();
    // Its time starts again: the first toast's hold does not end the second.
    wait(motion.duration.toastHold - 1);
    expect(toast().style.opacity).toBe('1');
    wait(1 + motion.duration.fade);
    expect(toasts()).toHaveLength(0);

    // One that is fading out is replaced as well, at full strength.
    show(STATES.success);
    wait(motion.duration.toastHold);
    expect(toast().style.opacity).toBe('0');
    show(STATES.warning);
    expect(toasts()).toHaveLength(1);
    expect(toast().style.opacity).toBe('1');
    wait(motion.duration.fade);
    expect(within(toast()).getByText(STATES.warning.text)).toBeDefined();
  });

  it('does nothing without a host', () => {
    cleanup();
    renderWithProviders(<View testID={PAGE} />);
    showToast(STATES.error);
    expect(toasts()).toHaveLength(0);
    expect(hapticsFake.calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // A host mounted afterwards has nothing to show.
    mount();
    expect(toasts()).toHaveLength(0);
    // And a host that leaves takes its toast with it.
    show(STATES.success);
    expect(toasts()).toHaveLength(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    mount();
    expect(toasts()).toHaveLength(0);
  });

  it('takes the testID it is given', () => {
    mount();
    show({ ...STATES.success, testID: 'probe.toast' });
    expect(toasts()).toHaveLength(0);
    expect(within(toast('probe.toast')).getByText('Link copied')).toBeDefined();
  });

  it('stands above the bottom chrome on a phone and in the content slot beside the rail', () => {
    mount();
    show(STATES.success);
    // A phone with nothing at the bottom edge: over the bottom inset, which the fixture has none of.
    expect(layer().style.position).toBe('absolute');
    expect(layer().style.alignItems).toBe('center');
    expect(layer().style.zIndex).toBe(String(z.toast));
    expect(window.getComputedStyle(layer()).pointerEvents).toBe('none');
    expect(layer().style.left).toBe('0px');
    expect(layer().style.right).toBe('0px');
    expect(layer().style.bottom).toBe(`${String(space.x4)}px`);
    expect(layer().style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(layer().style.paddingRight).toBe(`${String(gutter.regular)}px`);
    expect(layer().contains(toast())).toBe(true);

    // A tab bar reports its height, and the toast stands above it.
    act(() => {
      reportBottomChrome('probe', size.tabBar);
    });
    expect(layer().style.bottom).toBe(`${String(size.tabBar + space.x4)}px`);
    act(() => {
      clearBottomChrome('probe');
    });
    expect(layer().style.bottom).toBe(`${String(space.x4)}px`);

    // Medium, on a screen with no rail: centered in the window, which is the whole content slot.
    setViewport(...MEDIUM);
    expect(layer().style.left).toBe('0px');
    expect(layer().style.right).toBe('0px');
    expect(layer().style.bottom).toBe(`${String(space.x6)}px`);
    // The shell draws the icon rail and says so: the toast stands right of it.
    act(() => {
      reportSideChrome('probe', size.railIcon);
    });
    expect(layer().style.left).toBe(`${String(size.railIcon)}px`);
    expect(layer().style.right).toBe('0px');
    act(() => {
      clearSideChrome('probe');
    });

    // Expanded, with no rail: centered in the capped row, which is centered in the window.
    setViewport(...EXPANDED);
    const margin = (EXPANDED[0] - size.contentMax) / 2;
    expect(margin).toBeGreaterThan(0);
    expect(layer().style.left).toBe(`${String(margin)}px`);
    expect(layer().style.right).toBe(`${String(margin)}px`);
    expect(layer().style.bottom).toBe(`${String(space.x6)}px`);
    // Right of the labeled rail, inside the capped row.
    act(() => {
      reportSideChrome('probe', size.rail);
    });
    expect(layer().style.left).toBe(`${String(margin + size.rail)}px`);
    expect(layer().style.right).toBe(`${String(margin)}px`);
    act(() => {
      clearSideChrome('probe');
    });
    expect(layer().style.left).toBe(`${String(margin)}px`);
  });

  it('the shell says which rail it draws, and a shell without chrome says none', () => {
    const shell = (mode: 'app' | 'bare'): JSX.Element => (
      <ToastHost>
        <AppShell
          mode={mode}
          active="home"
          onNavigate={() => undefined}
          onReselect={() => undefined}
          unread={{ activity: 0, messages: 0 }}
          place={null}
          topBar={null}
          banner={null}
          signedIn={true}
        >
          <View testID={PAGE} />
        </AppShell>
      </ToastHost>
    );
    /** The left edge of the layer the host draws the toast in. */
    const leftOf = (mode: 'app' | 'bare', viewport: readonly [number, number]): string => {
      cleanup();
      setViewport(viewport[0], viewport[1]);
      renderWithProviders(shell(mode));
      show(STATES.success);
      const drawn = toast().parentElement;
      if (drawn === null) {
        throw new Error('the host drew no layer');
      }
      return drawn.style.left;
    };
    const margin = (EXPANDED[0] - size.contentMax) / 2;
    expect(leftOf('app', COMPACT)).toBe('0px');
    expect(leftOf('app', MEDIUM)).toBe(`${String(size.railIcon)}px`);
    expect(leftOf('app', EXPANDED)).toBe(`${String(margin + size.rail)}px`);
    // Welcome, sign-in, onboarding and the system screens have no rail: the toast is centered.
    expect(leftOf('bare', MEDIUM)).toBe('0px');
    expect(leftOf('bare', EXPANDED)).toBe(`${String(margin)}px`);
  });

  it('is drawn inside an open dialog, above its scrim, and nowhere else', () => {
    function WithDialog({ open }: { open: boolean }): JSX.Element {
      return (
        <ToastHost>
          <View testID={PAGE} />
          <Dialog
            open={open}
            onClose={() => undefined}
            title="Delete this post?"
            testID={OVERLAY}
          />
        </ToastHost>
      );
    }
    for (const viewport of [COMPACT, MEDIUM, EXPANDED]) {
      cleanup();
      setViewport(viewport[0], viewport[1]);
      const view = renderWithProviders(<WithDialog open={true} />);
      // A rail under the dialog does not move a toast that stands in the window.
      act(() => {
        reportSideChrome('probe', size.rail);
        reportBottomChrome('probe', size.tabBar);
      });
      show(STATES.error);
      const frame = screen.getByTestId(OVERLAY);
      const root = frame.parentElement;
      expect(toasts(), String(viewport[0])).toHaveLength(1);
      // In the dialog's own layer, beside its frame and its scrim, so nothing covers it and a
      // screen reader held inside the dialog reaches it.
      const drawn = toast().parentElement;
      expect(drawn?.parentElement, String(viewport[0])).toBe(root);
      expect(view.container.contains(toast()), String(viewport[0])).toBe(false);
      expect(drawn?.style.zIndex).toBe(String(z.toast));
      expect(Number(drawn?.style.zIndex)).toBeGreaterThan(Number(frame.style.zIndex));
      expect(window.getComputedStyle(drawn ?? frame).pointerEvents).toBe('none');
      // Centered in the window the dialog covers: no rail and no tab bar count.
      expect(drawn?.style.left, String(viewport[0])).toBe('0px');
      expect(drawn?.style.right, String(viewport[0])).toBe('0px');
      expect(drawn?.style.bottom, String(viewport[0])).toBe(
        `${String(viewport === COMPACT ? space.x4 : space.x6)}px`,
      );
      expect(toast().getAttribute('role')).toBe('alert');

      // The dialog closes and goes: the toast that still holds is the host's again.
      view.rerender(<WithDialog open={false} />);
      wait(motion.duration.fade);
      expect(screen.queryByTestId(OVERLAY)).toBeNull();
      expect(toasts(), String(viewport[0])).toHaveLength(1);
      expect(view.container.contains(toast()), String(viewport[0])).toBe(true);
      act(() => {
        clearSideChrome('probe');
        clearBottomChrome('probe');
      });
    }
  });

  it('is drawn inside an open sheet on a phone', () => {
    function WithSheet({ open }: { open: boolean }): JSX.Element {
      return (
        <ToastHost>
          <View testID={PAGE} />
          <Sheet
            open={open}
            onClose={() => undefined}
            title="Not interested?"
            footer={<View testID="sheet-footer" />}
            testID={OVERLAY}
          >
            <View testID="sheet-content" />
          </Sheet>
        </ToastHost>
      );
    }
    renderWithProviders(<WithSheet open={true} />);
    show(STATES.success);
    const frame = screen.getByTestId(OVERLAY);
    expect(toasts()).toHaveLength(1);
    // Inside the sheet's frame, rising from the line between its content and its footer, so it
    // covers no button of the sheet.
    const drawn = toast().parentElement;
    const anchor = drawn?.parentElement;
    expect(anchor?.parentElement).toBe(frame);
    expect(anchor?.style.height).toBe('0px');
    expect(anchor?.previousElementSibling).toBe(screen.getByTestId('sheet-content'));
    expect(anchor?.nextElementSibling?.contains(screen.getByTestId('sheet-footer'))).toBe(true);
    expect(drawn?.style.position).toBe('absolute');
    expect(drawn?.style.left).toBe('0px');
    expect(drawn?.style.right).toBe('0px');
    expect(drawn?.style.bottom).toBe('0px');
    expect(drawn?.style.zIndex).toBe(String(z.toast));

    // A sheet that is closed draws no toast: the host does.
    cleanup();
    renderWithProviders(<WithSheet open={false} />);
    show(STATES.success);
    expect(toasts()).toHaveLength(1);
    expect(screen.queryByTestId(OVERLAY)?.contains(toast()) ?? false).toBe(false);
    expect(toast().parentElement?.style.bottom).toBe(`${String(space.x4)}px`);
    expect(toast().parentElement?.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
  });
});
