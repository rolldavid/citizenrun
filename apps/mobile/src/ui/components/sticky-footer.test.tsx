import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';
import { color, gutter, opacity, rule, size, space, textScale, z } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { StickyFooter } from './sticky-footer';
import type { StickyFooterProps } from './sticky-footer';
import { GROUND, PREVIEW, STATES } from './sticky-footer.fixtures';

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

// The layout the footer reads: a phone, tight or not as a case sets it.
const layout = vi.hoisted(() => {
  const state: { isTight: boolean; width: number } = { isTight: false, width: 390 };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout => ({
      ...actual.layoutFor({ width: layout.width, height: 844, fontScale: 1, topBarHeight: 0 }),
      isTight: layout.isTight,
    }),
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'primaryOnly',
  'primaryDisabled',
  'primaryBusy',
  'withSecondary',
  'withInfo',
  'secondaryOnly',
] as const;

const ALL: Readonly<Record<StateName, StickyFooterProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;

afterEach(() => {
  layout.isTight = false;
  layout.width = 390;
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** The bar a render drew: the one view under a rule of its own. */
function barOf(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>('[style*="border-top-width"]');
  if (bar === null) {
    throw new Error('no footer was drawn');
  }
  return bar;
}

/** Renders one footer, in place of whatever was drawn before, and gives back its bar. */
function draw(props: StickyFooterProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  return barOf(renderWithProviders(<StickyFooter {...props} />, options).container);
}

/** The row of a bar: its one child, which holds the info and the buttons. */
function rowOf(bar: HTMLElement): HTMLElement {
  const row = bar.firstElementChild;
  if (!(row instanceof HTMLElement)) {
    throw new Error('the footer has no row');
  }
  return row;
}

/** The box a button draws: the part that carries its height and its fill. */
function faceOf(button: HTMLElement): HTMLElement {
  const face = button.querySelector<HTMLElement>('[style*="min-height"]');
  if (face === null) {
    throw new Error('the button has no face');
  }
  return face;
}

/** The part of the row a button stands in. */
function slotOf(bar: HTMLElement, button: HTMLElement): HTMLElement {
  const slot = [...rowOf(bar).children].find((child) => child.contains(button));
  if (!(slot instanceof HTMLElement)) {
    throw new Error('the button stands outside the row');
  }
  return slot;
}

describe('StickyFooter', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <StickyFooter {...ALL[state]} />
          </InteractionPreview>,
          { theme },
        );
        const bar = barOf(view.container);
        // The page's ground under a hairline, the gutter at each side, over what scrolls under it.
        expect(bar.style.backgroundColor, state).toBe(written(color[theme].bg));
        expect(bar.style.borderTopWidth, state).toBe(`${String(rule.hairline)}px`);
        expect(bar.style.borderTopColor, state).toBe(written(color[theme].rule));
        expect(bar.style.paddingTop, state).toBe(`${String(space.x3)}px`);
        expect(bar.style.paddingBottom, state).toBe(`${String(space.x3)}px`);
        expect(bar.style.paddingLeft, state).toBe(`${String(gutter.regular)}px`);
        expect(bar.style.paddingRight, state).toBe(`${String(gutter.regular)}px`);
        expect(bar.style.zIndex, state).toBe(String(z.sticky));
        expect(rowOf(bar).style.gap, state).toBe(`${String(space.x3)}px`);
        const fixture = ALL[state];
        for (const action of [fixture.secondary, fixture.primary]) {
          if (action !== undefined) {
            const button = screen.getByTestId(action.testID);
            expect(button.textContent, state).toBe(action.label);
            expect(faceOf(button).style.minHeight, state).toBe(`${String(size.button)}px`);
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.primaryDisabled.primary).toMatchObject({
      label: 'Pick 3 or more',
      disabled: true,
    });
    expect(STATES.primaryBusy.primary.busy).toBe(true);
    expect(STATES.withSecondary.secondary.label).toBe('Skip');
    expect(STATES.withSecondary.primary.label).toBe('Continue');
    expect(STATES.withInfo.info.helper).toBeDefined();
    expect(STATES.withInfo.primary.label).toBe('Continue');
    expect(Object.keys(STATES.secondaryOnly)).toEqual(['secondary']);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const bar = draw(ALL[state]);
      const fixture = ALL[state];
      const actions = [fixture.secondary, fixture.primary].filter((action) => action !== undefined);
      // Every button is named by its label, and the bar holds no other control.
      const buttons = within(bar).getAllByRole('button');
      expect(buttons, state).toHaveLength(actions.length);
      actions.forEach((action, index) => {
        expect(buttons[index]?.getAttribute('aria-label'), state).toBe(action.label);
        expect(buttons[index], state).toBe(screen.getByTestId(action.testID));
      });
    }
    // A footer button that goes somewhere is a link.
    const bar = draw({
      primary: { label: 'Continue', href: '/dev/gallery', testID: 'probe.next' },
    });
    expect(within(bar).getByRole('link', { name: 'Continue' })).toBe(
      screen.getByTestId('probe.next'),
    );
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const bar = draw(ALL[state]);
      for (const button of within(bar).getAllByRole('button')) {
        expect(button.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
      const ids = within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('data-testid'));
      expect(new Set(ids).size, state).toBe(ids.length);
    }
  });

  it('respects reduced motion', () => {
    const low = String(opacity.skeletonLow);
    const waiting = (): HTMLElement | null =>
      screen
        .getByTestId(STATES.primaryBusy.primary.testID)
        .querySelector<HTMLElement>('[style*="opacity"]');
    // A busy primary pulses with motion, and is held at the low point of the pulse without it.
    draw(STATES.primaryBusy);
    expect(waiting()?.style.opacity).toBe('1');
    draw(STATES.primaryBusy, { reducedMotion: true });
    expect(waiting()?.style.opacity).toBe(low);
    // The bar itself never moves.
    for (const reducedMotion of [false, true]) {
      for (const state of STATE_NAMES) {
        const bar = draw(ALL[state], { reducedMotion });
        for (const part of [bar, rowOf(bar)]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('info is live', () => {
    const bar = draw(STATES.withInfo);
    const line = within(bar).getByText(STATES.withInfo.info.line);
    const helper = within(bar).getByText(STATES.withInfo.info.helper);
    const info = line.closest<HTMLElement>('[aria-live]');
    expect(info?.getAttribute('aria-live')).toBe('polite');
    expect(info?.contains(helper)).toBe(true);
    // The line in the label role and the helper under it in the caption role, secondary.
    expect(line.style.fontSize).toBe('14px');
    expect(helper.style.fontSize).toBe('13px');
    expect(helper.style.color).toBe(written(color.light.textSecondary));
    expect(line.compareDocumentPosition(helper) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    // The info takes the room the row has left, and the button keeps its own width at the right.
    expect(rowOf(bar).firstElementChild).toBe(info);
    expect(info?.style.flexGrow).toBe('1');
    const button = screen.getByTestId(STATES.withInfo.primary.testID);
    expect(slotOf(bar, button).style.flexGrow).toBe('');
    expect(button.parentElement?.style.alignSelf).toBe('flex-start');
    expect(info?.contains(button)).toBe(false);
  });

  it('a narrow window at a large text size of the screen is tight too', () => {
    // The system's text size is the default; the screen's own is the large one.
    layout.isTight = false;
    layout.width = 360;
    const bar = draw(STATES.withInfo, { textScale: textScale.tightFrom });
    expect(within(bar).getByText(STATES.withInfo.info.line)).toBeDefined();
    expect(within(bar).queryByText(STATES.withInfo.info.helper)).toBeNull();
    // A wider phone at that size keeps the helper.
    layout.width = 390;
    const wide = draw(STATES.withInfo, { textScale: textScale.tightFrom });
    expect(within(wide).getByText(STATES.withInfo.info.helper)).toBeDefined();
  });

  it('tight drops the helper', () => {
    layout.isTight = true;
    layout.width = 360;
    const bar = draw(STATES.withInfo);
    expect(within(bar).getByText(STATES.withInfo.info.line)).toBeDefined();
    expect(within(bar).queryByText(STATES.withInfo.info.helper)).toBeNull();
    expect(bar.style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
    // And the primary button shows its short label, under the name it keeps.
    const short = draw({
      info: { line: '5 picked, 2 starred' },
      primary: {
        label: 'Continue to your offices',
        shortLabel: 'Continue',
        testID: 'probe.next',
      },
    });
    const button = within(short).getByRole('button');
    expect(button.textContent).toBe('Continue');
    expect(button.getAttribute('aria-label')).toBe('Continue to your offices');
  });

  it('needs an action', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup();
    expect(() => renderWithProviders(<StickyFooter />)).toThrow(
      'StickyFooter needs a primary or a secondary action',
    );
    cleanup();
    expect(() =>
      renderWithProviders(<StickyFooter info={{ line: '5 picked, 2 starred' }} />),
    ).toThrow('StickyFooter needs a primary or a secondary action');
    errors.mockRestore();
  });

  it('secondary alone sits at the right', () => {
    const bar = draw(STATES.secondaryOnly);
    const buttons = within(bar).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(rowOf(bar).style.justifyContent).toBe('flex-end');
    expect(rowOf(bar).children).toHaveLength(1);
    // At its own width, as the outline it is.
    const button = buttons[0];
    if (button === undefined) {
      throw new Error('the footer has no button');
    }
    expect(slotOf(bar, button).style.flexGrow).toBe('');
    expect(button.parentElement?.style.alignSelf).toBe('flex-start');
    expect(faceOf(button).style.borderColor).toBe(written(color.light.text));
    expect(faceOf(button).style.backgroundColor).toBe('');
  });

  it('without info the primary fills the row, after the secondary at its own width', () => {
    const alone = draw(STATES.primaryOnly);
    const only = screen.getByTestId(STATES.primaryOnly.primary.testID);
    expect(rowOf(alone).children).toHaveLength(1);
    expect(slotOf(alone, only).style.flexGrow).toBe('1');
    expect(only.parentElement?.style.alignSelf).toBe('stretch');
    expect(rowOf(alone).style.justifyContent).toBe('');
    // The ink button.
    expect(faceOf(only).style.backgroundColor).toBe(written(color.light.text));

    const both = draw(STATES.withSecondary);
    const skip = screen.getByTestId(STATES.withSecondary.secondary.testID);
    const next = screen.getByTestId(STATES.withSecondary.primary.testID);
    expect(skip.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(slotOf(both, skip).style.flexGrow).toBe('');
    expect(skip.parentElement?.style.alignSelf).toBe('flex-start');
    expect(slotOf(both, next).style.flexGrow).toBe('1');
    expect(next.parentElement?.style.alignSelf).toBe('stretch');
    // The quiet variant draws no box of its own.
    expect(faceOf(skip).style.backgroundColor).toBe('');
  });

  it('with info the secondary stands before the primary, both at their own width', () => {
    const bar = draw({
      info: { line: '5 picked, 2 starred' },
      secondary: { label: 'Skip', variant: 'quiet', testID: 'probe.skip' },
      primary: { label: 'Continue', testID: 'probe.next' },
    });
    const skip = screen.getByTestId('probe.skip');
    const next = screen.getByTestId('probe.next');
    expect(
      [...rowOf(bar).children].map((child) => child.contains(skip) || child.contains(next)),
    ).toEqual([false, true, true]);
    expect(skip.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    for (const button of [skip, next]) {
      expect(slotOf(bar, button).style.flexGrow).toBe('');
      expect(button.parentElement?.style.alignSelf).toBe('flex-start');
    }
  });

  it('a disabled primary says why in its label and takes no press, and a press reaches the caller', () => {
    const onPress = vi.fn();
    draw({ primary: { label: 'Pick 3 or more', disabled: true, onPress, testID: 'probe.next' } });
    const off = screen.getByTestId('probe.next');
    expect(off.textContent).toBe('Pick 3 or more');
    expect(off.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(off);
    expect(onPress).not.toHaveBeenCalled();
    expect(faceOf(off).style.backgroundColor).toBe(written(color.light.disabledBg));

    draw({ primary: { label: 'Continue', onPress, testID: 'probe.next' } });
    fireEvent.click(screen.getByTestId('probe.next'));
    expect(onPress).toHaveBeenCalledTimes(1);

    // A busy primary waits and takes no second press.
    draw({ primary: { label: 'Continue', busy: true, onPress, testID: 'probe.next' } });
    const busy = screen.getByTestId('probe.next');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('stands clear of the home indicator and of the insets at its sides', () => {
    cleanup();
    const view = renderWithProviders(
      <SafeAreaInsetsContext.Provider value={{ top: 47, right: 44, bottom: 34, left: 44 }}>
        <StickyFooter {...STATES.primaryOnly} />
      </SafeAreaInsetsContext.Provider>,
    );
    const bar = barOf(view.container);
    expect(bar.style.paddingBottom).toBe(`${String(space.x3 + 34)}px`);
    expect(bar.style.paddingTop).toBe(`${String(space.x3)}px`);
    expect(bar.style.paddingLeft).toBe(`${String(gutter.regular + 44)}px`);
    expect(bar.style.paddingRight).toBe(`${String(gutter.regular + 44)}px`);
  });
});
