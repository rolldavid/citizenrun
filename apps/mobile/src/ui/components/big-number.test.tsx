import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { clearOncePerItem, motion } from '@/ui/motion';
import { color, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';
import type { TypeRole } from '@/ui/typography';

import { BigNumber } from './big-number';
import type { BigNumberProps } from './big-number';
import { GROUND, PREVIEW, STATES } from './big-number.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'hero',
  'display',
  'title',
  'heading',
  'about',
  'unknown',
  'withMotion',
] as const;

const ALL: Readonly<Record<StateName, BigNumberProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const UNKNOWN = 'not known yet';
/** Longer than a frame, so the frame after the first one has been drawn. */
const A_FRAME_MS = 40;

const NUMERAL: Readonly<Record<BigNumberProps['size'], TypeRole>> = {
  hero: 'numeralHero',
  display: 'numeralDisplay',
  title: 'numeralTitle',
  heading: 'numeralHeading',
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one number, in place of whatever was drawn before, and gives back the element with its id. */
function draw(props: BigNumberProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<BigNumber {...props} />, options);
  if (props.testID === undefined) {
    throw new Error('every fixture number has a testID');
  }
  return screen.getByTestId(props.testID);
}

/** The row that holds the figure: the first child of the part hidden from screen readers. */
function figureRowOf(root: HTMLElement): HTMLElement {
  const row = root.firstElementChild?.firstElementChild;
  if (!(row instanceof HTMLElement)) {
    throw new Error('the number draws no figure row');
  }
  return row;
}

/** Expects `words` to be set in `role`. */
function expectRole(words: HTMLElement, role: TypeRole, name: string): void {
  const style = typography[role].style;
  expect(words.style.fontFamily, name).toContain(String(style.fontFamily));
  expect(parseFloat(words.style.fontSize), name).toBeCloseTo(style.fontSize ?? 0);
}

afterEach(() => {
  vi.useRealTimers();
  clearOncePerItem();
});

describe('BigNumber', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const root = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // The figure, or the tag in its place, then the label: never a dash and never a blank.
          const shown =
            props.value.text === null
              ? UNKNOWN
              : `${props.value.about ? 'about' : ''}${props.value.text}`;
          expect(root.textContent, name).toBe(`${shown}${props.label}`);
          const label = screen.getByText(props.label);
          expect(label.style.fontFamily, name).toContain('ChivoMono');
          expect(label.style.textTransform, name).toBe('uppercase');
          expect(parseFloat(label.style.fontSize), name).toBeCloseTo(
            (typography.monoLabel.style.fontSize ?? 0) * scale,
          );
          expect(label.style.color, name).toBe(written(color[theme].text));
          if (props.value.text !== null) {
            const figure = screen.getByText(props.value.text);
            expect(figure.style.color, name).toBe(written(color[theme].text));
            expect(figure.style.fontFamily, name).toContain(
              String(typography[NUMERAL[props.size]].style.fontFamily),
            );
          }
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.big-number-${kebab(state)}`);
    }
    expect(STATES.hero.value).toEqual({ text: '$52,900', about: false });
    expect(STATES.hero.label).toBe('a year');
    expect(STATES.display.value.text).toBe('$84,000,000');
    expect(STATES.title.value.text).toBe('85');
    expect(STATES.heading.value.text).toBe('12');
    expect(STATES.about.value).toEqual({ text: '2,100', about: true });
    expect(STATES.unknown.value).toEqual({ text: null, about: false });
    expect(STATES.withMotion.itemKey).toBe('fixture-big-number');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const root = draw(ALL[state]);
      expect(screen.getByRole('img', { name: ALL[state].accessibilityLabel }), state).toBe(root);
      // Nothing in it is a control.
      expect(root.querySelectorAll('[role]'), state).toHaveLength(0);
      expect(root.querySelectorAll('[tabindex]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const root = draw(ALL[state]);
      expect(root.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    for (const state of STATE_NAMES) {
      clearOncePerItem();
      const root = draw(ALL[state], { reducedMotion: true });
      const before = [root, ...root.querySelectorAll<HTMLElement>('*')];
      // Nothing moves: a figure seen for the first time only fades, and the others are still.
      for (const part of before) {
        expect(part.style.transform, state).toBe('');
        expect(part.style.animationName, state).toBe('');
      }
      const row = figureRowOf(root);
      if (state === 'withMotion') {
        expect(row.style.opacity, state).toBe('0');
        act(() => {
          vi.advanceTimersByTime(A_FRAME_MS);
        });
        expect(row.style.opacity, state).toBe('1');
        expect(row.style.transform, state).toBe('');
      } else {
        expect(row.style.transition, state).toBe('');
        expect(row.style.opacity, state).toBe('');
      }
    }
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      const root = draw(STATES.unknown, { theme });
      const words = screen.getByText(UNKNOWN);
      // The words, at full contrast, where the figure would be: never a dash, a zero or a blank.
      expect(words.style.color, theme).toBe(written(color[theme].text));
      expect(root.textContent, theme).toBe(`${UNKNOWN}votes to win`);
      for (const part of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
        expect(part.style.opacity, theme).toBe('');
      }
    }
  });

  it('about before the figure', () => {
    const root = draw(STATES.about);
    const row = figureRowOf(root);
    const about = screen.getByText('about');
    const figure = screen.getByText('2,100');
    expectRole(about, 'bodyStrong', 'about');
    expectRole(figure, 'numeralDisplay', 'figure');
    // One row on one baseline: the word, 8 points, the figure.
    expect(row.style.flexDirection).toBe('row');
    expect(row.style.alignItems).toBe('baseline');
    expect(row.style.columnGap).toBe(`${String(space.x2)}px`);
    expect(row.contains(about)).toBe(true);
    expect(row.contains(figure)).toBe(true);
    expect(about.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // At full contrast: an estimate is said in words, never drawn fainter.
    expect(about.style.color).toBe(written(color.light.text));
    expect(figure.style.color).toBe(written(color.light.text));
    // A figure that is not an estimate has no word before it.
    draw(STATES.display);
    expect(screen.queryByText('about')).toBeNull();
  });

  it("unknown in the figure's place", () => {
    const root = draw(STATES.unknown);
    const row = figureRowOf(root);
    const tag = screen.getByText(UNKNOWN);
    const label = screen.getByText('votes to win');
    // The tag stands in the figure row, above the label.
    expect(row.contains(tag)).toBe(true);
    expect(row.contains(label)).toBe(false);
    expect(tag.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.textContent).toBe(UNKNOWN);
    // No figure: nothing is set in a numeral role, and no word "about" stands before the tag.
    const numeral = String(typography.numeralDisplay.style.fontFamily);
    for (const part of root.querySelectorAll<HTMLElement>('*')) {
      expect(part.style.fontFamily).not.toContain(numeral);
    }
    draw({ ...STATES.unknown, value: { text: null, about: true } });
    expect(screen.queryByText('about')).toBeNull();
  });

  it("one element with the caller's sentence", () => {
    for (const state of STATE_NAMES) {
      const root = draw(ALL[state]);
      expect(root.getAttribute('aria-label'), state).toBe(ALL[state].accessibilityLabel);
      // Everything drawn is inside the one part hidden from screen readers.
      expect(root.children, state).toHaveLength(1);
      expect(root.firstElementChild?.getAttribute('aria-hidden'), state).toBe('true');
      expect(root.firstElementChild?.textContent, state).toBe(root.textContent);
    }
  });

  it('rises once per item', () => {
    vi.useFakeTimers();
    clearOncePerItem();
    const first = figureRowOf(draw(STATES.withMotion));
    // The first frame is the start of the rise: transparent, 6 points low.
    expect(first.style.opacity).toBe('0');
    expect(first.style.transform).toBe(`translateY(${String(motion.distance.riseNumber)}px)`);
    // The figure is its true value from that frame: it never counts up.
    expect(first.textContent).toBe('$52,900');
    act(() => {
      vi.advanceTimersByTime(A_FRAME_MS);
    });
    expect(first.style.opacity).toBe('1');
    expect(first.style.transform).toBe('translateY(0px)');
    expect(first.textContent).toBe('$52,900');

    // The same item again is still.
    const second = figureRowOf(draw(STATES.withMotion));
    expect(second.style.opacity).toBe('');
    expect(second.style.transform).toBe('');
    expect(second.style.transition).toBe('');
    act(() => {
      vi.advanceTimersByTime(A_FRAME_MS);
    });
    expect(second.style.opacity).toBe('');

    // A number without a key never rises, and neither does one nobody knows.
    clearOncePerItem();
    expect(figureRowOf(draw(STATES.hero)).style.opacity).toBe('');
    expect(
      figureRowOf(draw({ ...STATES.unknown, itemKey: 'fixture-unknown-number' })).style.opacity,
    ).toBe('');
  });

  it('never tabular', () => {
    for (const state of STATE_NAMES) {
      const root = draw(ALL[state]);
      // Proportional figures: a large number is set as a word is.
      for (const part of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
        expect(part.style.fontVariant, state).not.toContain('tabular-nums');
        expect(part.style.fontVariantNumeric, state).not.toContain('tabular-nums');
        expect(part.getAttribute('style') ?? '', state).not.toContain('tabular-nums');
      }
    }
  });
});
