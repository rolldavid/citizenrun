import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';
import { opacity, textScale } from '@/ui/tokens';

import { Button } from './button';
import type { ButtonProps, ButtonVariant } from './button';
import { GROUND, PREVIEW, STATES } from './button.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';

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

// The props each native Pressable receives, so the cases below can read what a phone is told: the
// web drops those props before they reach the page.
const pressables = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>();
  return {
    ...actual,
    Pressable: (props: ReactNative.PressableProps): ReactElement => {
      pressables.props.push({ ...props });
      return createElement(actual.Pressable, props);
    },
  };
});

// The layout the button reads: a narrow phone, tight or not as a case sets it.
const layout = vi.hoisted(() => {
  const state: { isTight: boolean } = { isTight: false };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout => ({
      ...actual.layoutFor({ width: 360, height: 740, fontScale: 1, topBarHeight: 0 }),
      isTight: layout.isTight,
    }),
  };
});

type StateName = keyof typeof STATES;

const VARIANTS = ['run', 'primary', 'secondary', 'quiet', 'destructive'] as const;
const FURTHER_STATES = [
  'primaryDone',
  'busy',
  'small',
  'twoLines',
  'withIcon',
  'withTrailingIcon',
  'fullWidth',
] as const;

const LABELS: Readonly<Record<ButtonVariant, { enabled: string; disabled: string }>> = {
  run: { enabled: 'Run for this office', disabled: 'Filing closed' },
  primary: { enabled: 'Continue', disabled: 'Continue' },
  secondary: { enabled: 'See the filing steps', disabled: 'See the filing steps' },
  quiet: { enabled: 'Skip', disabled: 'Skip' },
  destructive: { enabled: 'Delete account', disabled: 'Delete account' },
};

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.button';
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

const CHECK = 'M5 12.500 10 17.500 19 7';
const CALENDAR = 'M4 6h16v14H4zM4 10h16M8 3.500v4M16 3.500v4';
const CHEVRON_RIGHT = 'M9 5l7 7-7 7';

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** A color that paints nothing, as the web writes it. */
const CLEAR = 'rgba(0, 0, 0, 0)';

type Drawn = {
  /** The press target. */
  target: HTMLElement;
  /** The button's own box: its fill, its outline and its padding. */
  box: HTMLElement;
  /** The label's text. */
  label: HTMLElement;
  /** The view that sizes the button in its container. */
  outer: HTMLElement;
  /** The view that moves on press, in the variants that move. */
  mover: HTMLElement | null;
};

function parts(target: HTMLElement): Drawn {
  const box = target.querySelector<HTMLElement>('[style*="min-height"]');
  const label = target.querySelector<HTMLElement>('[dir="auto"]');
  const outer = target.parentElement;
  if (box === null || label === null || outer === null) {
    throw new Error('the button is missing a part');
  }
  return { target, box, label, outer, mover: target.querySelector('[style*="transform"]') };
}

function show(
  element: ReactElement,
  preview: InteractionPreviewState | undefined,
  options: RenderWithProvidersOptions,
): void {
  cleanup();
  pressables.props = [];
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): Drawn {
  show(<Button {...STATES[state]} />, preview, options);
  return parts(screen.getByTestId(STATES[state].testID));
}

/** Renders one C-Button, in place of whatever was drawn before. */
function draw(
  props: ButtonProps,
  options: RenderWithProvidersOptions = {},
  preview?: InteractionPreviewState,
): Drawn {
  show(<Button {...props} />, preview, options);
  return parts(screen.getByTestId(props.testID));
}

/** The props C-Pressable gave the native Pressable. */
function nativeProps(): Record<string, unknown> {
  const found = pressables.props.at(-1);
  if (found === undefined) {
    throw new Error('no native Pressable was rendered');
  }
  return found;
}

/** Asserts that the box draws no outline: its border is there for its width only. */
function expectNoOutline(box: HTMLElement, what: string): void {
  expect(box.style.borderColor, what).toBe(CLEAR);
}

/** The path data of the icons in a button, in the order they are drawn. */
function iconPaths(target: HTMLElement): (string | null)[] {
  return [...target.querySelectorAll('path')].map((path) => path.getAttribute('d'));
}

afterEach(() => {
  layout.isTight = false;
});

describe('Button', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of Object.keys(STATES) as StateName[]) {
        expect(drawState(state, { theme }).label.textContent, state).toBe(STATES[state].label);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold five states of each variant and the seven further states', () => {
    const names: string[] = [];
    const previews: Record<string, InteractionPreviewState> = {};
    for (const variant of VARIANTS) {
      names.push(
        variant,
        `${variant}Hover`,
        `${variant}Pressed`,
        `${variant}Focus`,
        `${variant}Disabled`,
      );
      previews[`${variant}Hover`] = { hovered: true };
      previews[`${variant}Pressed`] = { pressed: true };
      previews[`${variant}Focus`] = { focused: true };
      for (const suffix of ['', 'Hover', 'Pressed', 'Focus'] as const) {
        const props = STATES[`${variant}${suffix}`];
        expect(props.variant, `${variant}${suffix}`).toBe(variant);
        expect(props.label, `${variant}${suffix}`).toBe(LABELS[variant].enabled);
      }
      expect(STATES[`${variant}Disabled`]).toMatchObject({
        variant,
        disabled: true,
        label: LABELS[variant].disabled,
      });
    }
    expect(Object.keys(STATES)).toEqual([...names, ...FURTHER_STATES]);
    expect(PREVIEW).toEqual(previews);
    expect(GROUND).toEqual({});
    expect(STATES.primaryDone).toMatchObject({
      variant: 'primary',
      label: 'Following',
      done: true,
    });
    expect(STATES.small.size).toBe('sm');
    expect(STATES.twoLines.variant).toBe('secondary');
    expect(STATES.twoLines.label).toHaveLength(70);
    expect(STATES.withIcon).toMatchObject({ variant: 'secondary', icon: 'calendar' });
    expect(STATES.withTrailingIcon).toMatchObject({
      variant: 'secondary',
      trailingIcon: 'chevronRight',
    });
  });

  it('has a label and a role', () => {
    for (const state of Object.keys(STATES) as StateName[]) {
      const { target } = drawState(state);
      expect(screen.getByRole('button', { name: STATES[state].label }), state).toBe(target);
      expect(target.getAttribute('aria-label'), state).toBe(STATES[state].label);
      // An icon in a button adds nothing to its name.
      expect(target.querySelectorAll('[role], [aria-label]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    for (const state of Object.keys(STATES) as StateName[]) {
      const { target } = drawState(state);
      expect(target.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(target.getAttribute('data-testid'), state).toBe(`gallery.button-${kebab(state)}`);
    }
  });

  it('respects reduced motion', () => {
    for (const state of Object.keys(STATES) as StateName[]) {
      const { target } = drawState(state, { reducedMotion: true }, { pressed: true });
      for (const part of [target, ...target.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
      }
    }
    // The same press moves the buttons that move where motion is allowed.
    for (const state of ['runPressed', 'primaryPressed', 'secondaryPressed'] as const) {
      const moving = drawState(state).target;
      expect(
        moving.querySelector<HTMLElement>('[style*="transform"]')?.style.transform,
        state,
      ).toBe(MOVED);
    }
    for (const state of ['quietPressed', 'destructivePressed'] as const) {
      expect(drawState(state).target.querySelector('[style*="transform"]'), state).toBeNull();
    }
  });

  it('run is the accent fill with an onAccent label and no outline', () => {
    const { box, label, target } = drawState('run');
    expect(box.style.backgroundColor).toBe(written('#F04E14'));
    expect(label.style.color).toBe(written('#141412'));
    expectNoOutline(box, 'run');
    expect(target.style.backgroundColor).toBe('');
    // The accent and its label are the same in both themes.
    const dark = drawState('run', { theme: 'dark' });
    expect(dark.box.style.backgroundColor).toBe(written('#F04E14'));
    expect(dark.label.style.color).toBe(written('#141412'));
  });

  it('primary is the ink fill with an inverse label and no outline', () => {
    const { box, label } = drawState('primary');
    expect(box.style.backgroundColor).toBe(written('#141412'));
    expect(label.style.color).toBe(written('#F3F1EA'));
    expectNoOutline(box, 'primary');
    const dark = drawState('primary', { theme: 'dark' });
    expect(dark.box.style.backgroundColor).toBe(written('#F3F1EA'));
    expect(dark.label.style.color).toBe(written('#141412'));
  });

  it('secondary has no fill, a hairline of rule and a text label', () => {
    const { box, label, target } = drawState('secondary');
    expect(box.style.backgroundColor).toBe('');
    expect(target.style.backgroundColor).toBe('');
    expect(box.style.borderWidth).toBe('1px');
    expect(box.style.borderColor).toBe(written('#141412'));
    expect(label.style.color).toBe(written('#141412'));
    const dark = drawState('secondary', { theme: 'dark' });
    expect(dark.box.style.borderColor).toBe(written('#A9A69B'));
    expect(dark.label.style.color).toBe(written('#F3F1EA'));
  });

  it('quiet has no fill and no outline', () => {
    const { box, label, target } = drawState('quiet');
    expect(box.style.backgroundColor).toBe('');
    expect(target.style.backgroundColor).toBe('');
    expectNoOutline(box, 'quiet');
    expect(label.style.color).toBe(written('#141412'));
  });

  it('destructive has no fill, a hairline of danger and a danger label', () => {
    const { box, label } = drawState('destructive');
    expect(box.style.backgroundColor).toBe('');
    expect(box.style.borderWidth).toBe('1px');
    expect(box.style.borderColor).toBe(written('#B3202A'));
    expect(label.style.color).toBe(written('#B3202A'));
    const dark = drawState('destructive', { theme: 'dark' });
    expect(dark.box.style.borderColor).toBe(written('#FD8692'));
    expect(dark.label.style.color).toBe(written('#FD8692'));
  });

  it('a pointer swaps the fill: accentHover, inverseHover, and hoverBg on the rest', () => {
    expect(drawState('runHover').box.style.backgroundColor).toBe(written('#E84603'));
    expect(drawState('runHover', { theme: 'dark' }).box.style.backgroundColor).toBe(
      written('#FA5824'),
    );
    expect(drawState('primaryHover').box.style.backgroundColor).toBe(written('#2A2A26'));
    expect(drawState('primaryHover', { theme: 'dark' }).box.style.backgroundColor).toBe(
      written('#E3E0D5'),
    );
    // The filled buttons paint their own box; the press target under them stays clear.
    expect(drawState('runHover').target.style.backgroundColor).toBe('');
    expect(drawState('primaryHover').target.style.backgroundColor).toBe('');

    for (const state of ['quietHover', 'destructiveHover'] as const) {
      const hovered = drawState(state);
      expect(hovered.target.style.backgroundColor, state).toBe(written('#E3E0D5'));
      expect(hovered.box.style.backgroundColor, state).toBe('');
    }
    // The outline button moves on press, so the view that moves carries its fill.
    const secondary = drawState('secondaryHover');
    expect(secondary.mover?.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(secondary.mover?.style.borderRadius).toBe('4px');
    expect(secondary.target.style.backgroundColor).toBe('');
    expect(secondary.box.style.backgroundColor).toBe('');
    expect(drawState('secondaryHover', { theme: 'dark' }).mover?.style.backgroundColor).toBe(
      written('#2A2A26'),
    );
  });

  it('a press fills the outline and quiet buttons with pressedBg and leaves the filled ones', () => {
    for (const state of ['quietPressed', 'destructivePressed'] as const) {
      expect(drawState(state).target.style.backgroundColor, state).toBe(written('#E3E0D5'));
    }
    // The outline button's fill moves with its outline, and stays inside it.
    const secondary = drawState('secondaryPressed');
    expect(secondary.mover?.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(secondary.mover?.style.transform).toBe(MOVED);
    expect(secondary.mover?.contains(secondary.box)).toBe(true);
    expect(secondary.target.style.backgroundColor).toBe('');
    expect(drawState('runPressed').box.style.backgroundColor).toBe(written('#F04E14'));
    expect(drawState('primaryPressed').box.style.backgroundColor).toBe(written('#141412'));
  });

  it('pressed under reduced motion swaps run to accentHover and primary to inverseHover', () => {
    const reduced = { reducedMotion: true };
    expect(drawState('runPressed', reduced).box.style.backgroundColor).toBe(written('#E84603'));
    expect(drawState('primaryPressed', reduced).box.style.backgroundColor).toBe(written('#2A2A26'));
    // The outline button already fills on press.
    expect(drawState('secondaryPressed', reduced).mover?.style.backgroundColor).toBe(
      written('#E3E0D5'),
    );
    // Nothing is pressed: the fill is the idle one.
    expect(drawState('run', reduced).box.style.backgroundColor).toBe(written('#F04E14'));
  });

  it('disabled is disabledBg with a disabledText label and no outline', () => {
    for (const variant of ['run', 'primary', 'secondary', 'destructive'] as const) {
      const state = `${variant}Disabled` as const;
      const { box, label, target } = drawState(state);
      expect(box.style.backgroundColor, state).toBe(written('#E3E0D5'));
      expect(label.style.color, state).toBe(written('#535148'));
      expectNoOutline(box, state);
      expect(target.getAttribute('aria-disabled'), state).toBe('true');
      expect(target.getAttribute('tabindex'), state).toBe('-1');
      const dark = drawState(state, { theme: 'dark' });
      expect(dark.box.style.backgroundColor, state).toBe(written('#2A2A26'));
      expect(dark.label.style.color, state).toBe(written('#A9A69B'));
    }
  });

  it('a disabled quiet button gains no fill: its label alone turns disabledText', () => {
    const { box, label, target } = drawState('quietDisabled');
    expect(box.style.backgroundColor).toBe('');
    expect(target.style.backgroundColor).toBe('');
    expectNoOutline(box, 'quietDisabled');
    expect(label.style.color).toBe(written('#535148'));
  });

  it('every variant keeps the width of an outline, so a button does not change size', () => {
    for (const state of Object.keys(STATES) as StateName[]) {
      expect(drawState(state).box.style.borderWidth, state).toBe('1px');
    }
  });

  it('a disabled button takes no press', () => {
    const onPress = vi.fn();
    const { target } = draw({ ...STATES.runDisabled, onPress, haptic: 'success' });
    fireEvent.click(target);
    expect(onPress).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
  });

  it('a press reaches the caller once, with its haptic', () => {
    const onPress = vi.fn();
    fireEvent.click(draw({ ...STATES.run, onPress, haptic: 'success' }).target);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hapticsFake.calls).toEqual([{ method: 'notify', kind: 'success' }]);
  });

  it('busy ignores presses, says it is busy and keeps its fill', () => {
    const onPress = vi.fn();
    const { target, box, label } = draw({ ...STATES.busy, onPress, haptic: 'light' });
    fireEvent.click(target);
    expect(onPress).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    expect(target.getAttribute('aria-busy')).toBe('true');
    // Waiting is not disabled: the button stays in the Tab order and keeps its look.
    expect(target.getAttribute('aria-disabled')).toBeNull();
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(box.style.backgroundColor).toBe(written('#141412'));
    expect(label.textContent).toBe('Continue');
    // The label sits in the view that pulses; there is no spinner.
    expect(label.closest<HTMLElement>('[style*="opacity"]')).not.toBeNull();
    expect(box.contains(label.closest('[style*="opacity"]'))).toBe(true);

    const idle = drawState('primary');
    expect(idle.target.getAttribute('aria-busy')).toBe('false');
    expect(idle.target.querySelector('[style*="opacity"]')).toBeNull();
  });

  it('under reduced motion a busy button holds its label at the low point of the pulse', () => {
    const low = String(opacity.skeletonLow);
    // With motion the pulse starts from full strength; nothing is held.
    const moving = drawState('busy', { reducedMotion: false });
    expect(moving.label.closest<HTMLElement>('[style*="opacity"]')?.style.opacity).toBe('1');
    const busy = drawState('busy', { reducedMotion: true });
    const held = busy.label.closest<HTMLElement>('[style*="opacity"]');
    expect(held).not.toBeNull();
    expect(held?.style.opacity).toBe(low);
    // The icon and the label are held together, and the box keeps its fill at full strength.
    expect(busy.box.contains(held)).toBe(true);
    expect(busy.box.style.opacity).toBe('');
    expect(busy.box.style.backgroundColor).toBe(written('#141412'));
    expect(busy.target.getAttribute('aria-busy')).toBe('true');
    // At rest the same button holds nothing back.
    const idle = drawState('primary', { reducedMotion: true });
    expect(idle.target.querySelector('[style*="opacity"]')).toBeNull();
  });

  it('a busy link is not followed', () => {
    const { target } = draw({ ...STATES.busy, href: '/dev/gallery' });
    expect(target.tagName).not.toBe('A');
    expect(target.getAttribute('href')).toBeNull();
  });

  it('done draws the check before the label', () => {
    const { target, label, box } = drawState('primaryDone');
    expect(iconPaths(target)).toEqual([CHECK]);
    const icon = target.querySelector('svg');
    expect(icon?.getAttribute('width')).toBe('20');
    // The check comes first, in the label's color.
    expect(icon?.compareDocumentPosition(label)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(target.querySelector('path')?.getAttribute('stroke')).toBe('#F3F1EA');
    expect(box.style.gap).toBe('8px');
    // The label already says it: the name is the label and nothing more.
    expect(target.getAttribute('aria-label')).toBe('Following');
    expect(iconPaths(drawState('primary').target)).toEqual([]);
  });

  it('an icon goes before the label and the chevron after it', () => {
    const leading = drawState('withIcon');
    expect(iconPaths(leading.target)).toEqual([CALENDAR]);
    expect(leading.target.querySelector('svg')?.compareDocumentPosition(leading.label)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(leading.target.querySelector('path')?.getAttribute('stroke')).toBe('#141412');

    const trailing = drawState('withTrailingIcon');
    expect(iconPaths(trailing.target)).toEqual([CHEVRON_RIGHT]);
    expect(trailing.target.querySelector('svg')?.compareDocumentPosition(trailing.label)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    // A disabled button draws its icons in disabledText too.
    const disabled = draw({ ...STATES.withIcon, disabled: true });
    expect(disabled.target.querySelector('path')?.getAttribute('stroke')).toBe('#535148');
  });

  it('the standard size is 44 points high with 16 at the sides and a bodyStrong label', () => {
    const { box, label } = drawState('secondary');
    expect(box.style.minHeight).toBe('44px');
    expect(box.style.height).toBe('');
    expect(box.style.paddingLeft).toBe('16px');
    expect(box.style.paddingRight).toBe('16px');
    expect(box.style.borderRadius).toBe('4px');
    expect(label.style.fontFamily).toBe('SpecialGothic-Medium');
    expect(label.style.fontSize).toBe('16px');
    expect(label.style.textTransform).toBe('');
    expect(nativeProps().hitSlop).toBeUndefined();
  });

  it('small is 36 points high with 12 at the sides, a label label and hit slop 4', () => {
    const { box, label } = drawState('small');
    expect(box.style.minHeight).toBe('36px');
    expect(box.style.paddingLeft).toBe('12px');
    expect(box.style.paddingRight).toBe('12px');
    expect(label.style.fontFamily).toBe('SpecialGothic-Medium');
    expect(label.style.fontSize).toBe('14px');
    expect(nativeProps().hitSlop).toEqual({ top: 4, bottom: 4, left: 0, right: 0 });
  });

  it('a small button is pressed 4 points above and below its drawing on the page as well', () => {
    const onPress = vi.fn();
    const { target } = draw({ ...STATES.small, onPress });
    const reach = target.firstElementChild;
    if (!(reach instanceof HTMLElement)) {
      throw new Error('the small button has nothing in it');
    }
    // 4 points above and below the 36-point drawing: the 44-point target.
    expect(reach.style.position).toBe('absolute');
    expect(reach.style.top).toBe('-4px');
    expect(reach.style.bottom).toBe('-4px');
    expect(reach.style.left).toBe('0px');
    expect(reach.style.right).toBe('0px');
    expect(target.style.overflow).toBe('');
    fireEvent.click(reach);
    expect(onPress).toHaveBeenCalledTimes(1);
    // A button of the full height has nothing to add.
    const full = drawState('secondary').target;
    expect(full.querySelector('[style*="position: absolute"]')).toBeNull();
  });

  it('quiet has 8 points at the sides', () => {
    const { box } = drawState('quiet');
    expect(box.style.paddingLeft).toBe('8px');
    expect(box.style.paddingRight).toBe('8px');
  });

  it('every label is centered and clamped at two lines', () => {
    for (const state of Object.keys(STATES) as StateName[]) {
      const { label } = drawState(state);
      expect(window.getComputedStyle(label).webkitLineClamp, state).toBe('2');
      expect(label.style.textAlign, state).toBe('center');
      // The label can give way beside an icon, so a long one wraps.
      expect(label.parentElement?.style.flexShrink, state).toBe('1');
    }
    expect(drawState('twoLines').label.textContent).toBe(STATES.twoLines.label);
  });

  it('is never wider than the room it stands in', () => {
    // In a row that wraps, a button as wide as a long label would run off a narrow screen.
    for (const state of ['quiet', 'twoLines'] as const) {
      const outer = drawState(state).target.parentElement;
      expect(outer?.style.maxWidth, state).toBe('100%');
    }
  });

  it('a narrow window at a large text size of the screen draws the short label too', () => {
    const props = { ...STATES.run, shortLabel: 'Run' };
    layout.isTight = false;
    const large = draw(props, { textScale: textScale.tightFrom });
    expect(large.label.textContent).toBe('Run');
    expect(large.target.getAttribute('aria-label')).toBe('Run for this office');
  });

  it('the short label is drawn on a tight layout, and the name stays the long one', () => {
    const props = { ...STATES.run, shortLabel: 'Run' };
    layout.isTight = true;
    const tight = draw(props);
    expect(tight.label.textContent).toBe('Run');
    expect(tight.target.getAttribute('aria-label')).toBe('Run for this office');
    expect(screen.getByRole('button', { name: 'Run for this office' })).toBe(tight.target);
    // Without a short label the long one stays.
    expect(draw(STATES.run).label.textContent).toBe('Run for this office');

    layout.isTight = false;
    const roomy = draw(props);
    expect(roomy.label.textContent).toBe('Run for this office');
    expect(within(roomy.target).queryByText('Run')).toBeNull();
  });

  it('fullWidth stretches the button, and otherwise it is as wide as its label', () => {
    const full = drawState('fullWidth');
    expect(full.outer.style.alignSelf).toBe('stretch');
    expect(full.box.style.justifyContent).toBe('center');
    expect(drawState('primary').outer.style.alignSelf).toBe('flex-start');
  });

  it('focus draws the ring round the button', () => {
    for (const variant of VARIANTS) {
      const { target } = drawState(`${variant}Focus`);
      expect(target.style.outlineStyle, variant).toBe('solid');
      expect(target.style.outlineWidth, variant).toBe('2px');
      expect(target.style.outlineOffset, variant).toBe('2px');
      expect(target.style.outlineColor, variant).toBe(written('#141412'));
      expect(target.style.borderRadius, variant).toBe('4px');
    }
  });

  it('with an address it is a link', () => {
    const { target } = draw({ ...STATES.withTrailingIcon, href: '/dev/gallery' });
    expect(target.tagName).toBe('A');
    expect(target.getAttribute('href')).toBe('/dev/gallery');
    expect(screen.getByRole('link', { name: 'See the filing steps' })).toBe(target);
  });

  it('an accessible name apart from the label', () => {
    const { target, label } = draw({
      ...STATES.run,
      label: 'Run',
      accessibilityLabel: 'Run for this office',
    });
    // The words stay short, and the name says all of it.
    expect(label.textContent).toBe('Run');
    expect(target.getAttribute('aria-label')).toBe('Run for this office');
    expect(screen.getByRole('button', { name: 'Run for this office' })).toBe(target);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    // It wins over a short label's long one as well.
    layout.isTight = true;
    const tight = draw({
      ...STATES.run,
      shortLabel: 'Run',
      accessibilityLabel: 'Run for County Treasurer',
    });
    expect(tight.label.textContent).toBe('Run');
    expect(tight.target.getAttribute('aria-label')).toBe('Run for County Treasurer');
    layout.isTight = false;
    // Without one the label is the name.
    expect(draw({ ...STATES.run, label: 'Run' }).target.getAttribute('aria-label')).toBe('Run');
  });

  it('a hint', () => {
    draw({ ...STATES.primary, accessibilityHint: 'Press to stop following' });
    expect(nativeProps()['accessibilityHint']).toBe('Press to stop following');
    // The hint is no part of the name.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
    draw(STATES.primary);
    expect(nativeProps()['accessibilityHint']).toBeUndefined();
  });

  it('a selected state', () => {
    const on = draw({ ...STATES.primary, selected: true });
    // A button that holds a state is pressed: a button may not carry aria-selected.
    expect(on.target.getAttribute('aria-pressed')).toBe('true');
    expect(on.target.hasAttribute('aria-selected')).toBe(false);
    expect(nativeProps()['accessibilityState']).toMatchObject({ selected: true });
    const off = draw({ ...STATES.primary, selected: false });
    expect(off.target.getAttribute('aria-pressed')).toBe('false');
    expect(nativeProps()['accessibilityState']).toMatchObject({ selected: false });
    // It stays beside a wait.
    const waiting = draw({ ...STATES.busy, selected: true });
    expect(waiting.target.getAttribute('aria-busy')).toBe('true');
    expect(waiting.target.getAttribute('aria-pressed')).toBe('true');
    // A button with no such state says nothing of one.
    const plain = draw(STATES.primary);
    expect(plain.target.hasAttribute('aria-pressed')).toBe(false);
    expect(plain.target.hasAttribute('aria-selected')).toBe(false);
  });

  it('run never takes an icon', () => {
    // @ts-expect-error run never takes an icon
    const withIcon = <Button variant="run" icon="plus" label="Run" testID="gallery.button-x" />;
    expect(withIcon.props).toMatchObject({ variant: 'run', icon: 'plus' });
    // Every other variant takes one.
    const others = VARIANTS.filter((variant) => variant !== 'run').map((variant) => (
      <Button key={variant} variant={variant} icon="plus" label="Add" testID={PROBE} />
    ));
    expect(others).toHaveLength(4);
  });
});
