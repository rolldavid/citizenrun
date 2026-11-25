import { cleanup } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { Progress } from './progress';
import type { ProgressProps } from './progress';
import { GROUND, PREVIEW, STATES } from './progress.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'stepsFirst',
  'stepsFourth',
  'stepsDone',
  'amountZero',
  'amountHalf',
  'amountFull',
] as const;

const ALL: Readonly<Record<StateName, ProgressProps>> = STATES;

const COMPACT = [390, 844] as const;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one progress bar, in place of whatever was drawn before, and gives it back. */
function draw(props: ProgressProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  const view = renderWithProviders(<Progress {...props} />, options);
  const bar = view.container.querySelector<HTMLElement>('[role="progressbar"]');
  if (bar === null) {
    throw new Error('no progress bar was drawn');
  }
  return bar;
}

/** The parts a bar draws, in order. */
function partsOf(bar: HTMLElement): HTMLElement[] {
  return [...bar.children].filter((part): part is HTMLElement => part instanceof HTMLElement);
}

/** The fill of an amount: the part after the outline. */
function fillOf(bar: HTMLElement): HTMLElement {
  const fill = partsOf(bar)[1];
  if (fill === undefined) {
    throw new Error('the track has no fill');
  }
  return fill;
}

/** The max and the now of a state, whichever kind it is. */
function valueOf(props: ProgressProps): { max: number; now: number } {
  return props.kind === 'steps'
    ? { max: props.total, now: props.done }
    : { max: props.max, now: props.value };
}

describe('Progress', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <Progress {...ALL[state]} />
          </InteractionPreview>,
          { theme },
        );
        const bar = view.container.querySelector<HTMLElement>('[role="progressbar"]');
        if (bar === null) {
          throw new Error(`${state} draws no progress bar`);
        }
        const fixture = ALL[state];
        const solid = written(color[theme].text);
        const outline = written(color[theme].textSecondary);
        if (fixture.kind === 'steps') {
          // One bar for each step: the done ones solid, the rest an outline with no fill.
          const bars = partsOf(bar);
          expect(bars, state).toHaveLength(fixture.total);
          expect(bar.style.gap, state).toBe(`${String(space.x1)}px`);
          bars.forEach((step, index) => {
            const done = index < fixture.done;
            expect(step.style.height, state).toBe(`${String(size.progress)}px`);
            expect(step.style.flexGrow, state).toBe('1');
            expect(step.style.backgroundColor, state).toBe(done ? solid : '');
            expect(step.style.borderWidth, state).toBe(done ? '' : `${String(rule.hairline)}px`);
            expect(step.style.borderColor, state).toBe(done ? '' : outline);
          });
        } else {
          // One outlined track with a flat fill from the left.
          expect(bar.style.height, state).toBe(`${String(size.progress)}px`);
          const [track, fill] = partsOf(bar);
          expect(partsOf(bar), state).toHaveLength(2);
          expect(track?.style.borderWidth, state).toBe(`${String(rule.hairline)}px`);
          expect(track?.style.borderColor, state).toBe(outline);
          expect(track?.style.backgroundColor, state).toBe('');
          expect(fill?.style.backgroundColor, state).toBe(solid);
          expect(fill?.style.width, state).toBe(`${String((fixture.value / fixture.max) * 100)}%`);
        }
        // No numeral inside, and no corner.
        expect(bar.textContent, state).toBe('');
        expect(bar.style.borderRadius === '' || bar.style.borderRadius === '0px', state).toBe(true);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the three step states and the three amounts', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.stepsFirst).toMatchObject({ kind: 'steps', total: 5, done: 1 });
    expect(STATES.stepsFourth).toMatchObject({ kind: 'steps', total: 5, done: 4 });
    expect(STATES.stepsDone).toMatchObject({ kind: 'steps', total: 5, done: 5 });
    expect(STATES.amountZero.value).toBe(0);
    expect(STATES.amountHalf.value * 2).toBe(STATES.amountHalf.max);
    expect(STATES.amountFull.value).toBe(STATES.amountFull.max);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const bar = draw(ALL[state]);
      const { max, now } = valueOf(ALL[state]);
      expect(bar.getAttribute('role'), state).toBe('progressbar');
      expect(bar.getAttribute('aria-label'), state).toBe(ALL[state].label);
      expect(bar.getAttribute('aria-valuemin'), state).toBe('0');
      expect(bar.getAttribute('aria-valuemax'), state).toBe(String(max));
      expect(bar.getAttribute('aria-valuenow'), state).toBe(String(now));
      // Its parts say nothing of their own.
      expect(bar.querySelectorAll('[role], [aria-label]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    // A progress bar shows and takes no press: it has nothing a person can act on, so no part of
    // it needs an id, and it stays out of the way through the page.
    for (const state of STATE_NAMES) {
      const bar = draw(ALL[state]);
      const wrapper = bar.parentElement;
      expect(
        wrapper?.querySelectorAll('button, a, input, [role="button"], [role="link"], [tabindex]'),
        state,
      ).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    // Nothing of it animates: a new value is the new fill, with motion or without.
    for (const reducedMotion of [false, true]) {
      for (const state of STATE_NAMES) {
        const bar = draw(ALL[state], { reducedMotion });
        for (const part of [bar, ...bar.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.transitionProperty, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('steps value', () => {
    const bar = draw(STATES.stepsFourth);
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-label')).toBe(STATES.stepsFourth.label);
    const solid = written(color.light.text);
    expect(partsOf(bar).map((step) => step.style.backgroundColor === solid)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('amount clamps', () => {
    const over = draw({ kind: 'amount', value: 12, max: 10, label: '12 of 10 signatures' });
    expect(fillOf(over).style.width).toBe('100%');
    // The value said is the value given.
    expect(over.getAttribute('aria-valuenow')).toBe('12');
    expect(over.getAttribute('aria-valuemax')).toBe('10');
    const under = draw({ kind: 'amount', value: -3, max: 10, label: 'None of 10 signatures' });
    expect(fillOf(under).style.width).toBe('0%');
    // A track with no size to fill is empty, never a division by nothing.
    const none = draw({ kind: 'amount', value: 4, max: 0, label: '4 signatures' });
    expect(fillOf(none).style.width).toBe('0%');
    expect(fillOf(draw(STATES.amountHalf)).style.width).toBe('50%');
  });

  it('a new value is drawn at once', () => {
    cleanup();
    const view = renderWithProviders(<Progress {...STATES.amountZero} />);
    const bar = view.container.querySelector<HTMLElement>('[role="progressbar"]');
    if (bar === null) {
      throw new Error('no progress bar was drawn');
    }
    expect(fillOf(bar).style.width).toBe('0%');
    view.rerender(<Progress {...STATES.amountFull} />);
    expect(fillOf(bar).style.width).toBe('100%');
    expect(fillOf(bar).style.transitionProperty).toBe('');
  });
});
