import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { clearOncePerItem, motion } from '@/ui/motion';
import { color, rule, size } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { DeadlineRing } from './deadline-ring';
import type { DeadlineRingProps } from './deadline-ring';
import { GROUND, PREVIEW, STATES } from './deadline-ring.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = ['twelve', 'five', 'zero', 'fortyTwo', 'size120', 'withMotion'] as const;

const ALL: Readonly<Record<StateName, DeadlineRingProps>> = STATES;

/** The ticks each state lights and the count it shows. */
const EXPECTED: Readonly<Record<StateName, { lit: number; count: string; side: number }>> = {
  twelve: { lit: 12, count: '12', side: 96 },
  five: { lit: 5, count: '5', side: 96 },
  zero: { lit: 0, count: '0', side: 96 },
  fortyTwo: { lit: 30, count: '42', side: 96 },
  size120: { lit: 12, count: '12', side: 120 },
  withMotion: { lit: 12, count: '12', side: 96 },
};

/** Two frames: a timed run lands on the first frame at or after its end. */
const FRAME_SLACK_MS = 40;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one ring, in place of whatever was drawn before, and gives back its box. */
function draw(props: DeadlineRingProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  const { container } = renderWithProviders(<DeadlineRing {...props} />, options);
  const ring = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (ring === null) {
    throw new Error('the ring draws no box');
  }
  return ring;
}

/** The thirty ticks in order, and the part that holds the count. */
function partsOf(ring: HTMLElement): { ticks: HTMLElement[]; center: HTMLElement } {
  const children = [...ring.children].filter(
    (part): part is HTMLElement => part instanceof HTMLElement,
  );
  const center = children.at(-1);
  if (center === undefined) {
    throw new Error('the ring draws nothing');
  }
  return { ticks: children.slice(0, -1), center };
}

function isLit(tick: HTMLElement): boolean {
  return tick.style.backgroundColor !== '';
}

/** The turn of a tick in degrees, read from its transform. */
function turnOf(tick: HTMLElement): number {
  const found = /rotate\((-?[\d.]+)deg\)/.exec(tick.style.transform);
  if (found?.[1] === undefined) {
    throw new Error(`a tick with no turn: ${tick.style.transform}`);
  }
  return Number(found[1]);
}

/** How far out a tick stands, read from its transform. */
function reachOf(tick: HTMLElement): number {
  const found = /translateY\((-?[\d.]+)px\)/.exec(tick.style.transform);
  if (found?.[1] === undefined) {
    throw new Error(`a tick that does not stand out: ${tick.style.transform}`);
  }
  return Number(found[1]);
}

/** The opacity a tick is drawn at; a tick with none set is whole. */
function opacityOf(tick: HTMLElement): number {
  return tick.style.opacity === '' ? 1 : Number(tick.style.opacity);
}

afterEach(() => {
  vi.useRealTimers();
  clearOncePerItem();
});

describe('DeadlineRing', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const ring = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const { side, lit, count } = EXPECTED[state];
          const { ticks, center } = partsOf(ring);
          // A square box that the text size does not change.
          expect(ring.style.width, name).toBe(`${String(side)}px`);
          expect(ring.style.height, name).toBe(`${String(side)}px`);
          expect(ticks, name).toHaveLength(size.ring.ticks);
          expect(ticks.filter(isLit), name).toHaveLength(lit);
          ticks.forEach((tick, index) => {
            // Every tick is the same rectangle, placed from the middle of the box.
            expect(tick.style.position, name).toBe('absolute');
            expect(parseFloat(tick.style.width), name).toBeCloseTo(size.ring.tickShare * side);
            expect(parseFloat(tick.style.height), name).toBeCloseTo(
              (size.ring.outerShare - size.ring.innerShare) * side,
            );
            expect(reachOf(tick), name).toBeCloseTo(
              -((size.ring.innerShare + size.ring.outerShare) / 2) * side,
            );
            if (index < lit) {
              expect(tick.style.backgroundColor, name).toBe(written(color[theme].text));
              expect(tick.style.borderTopWidth, name).toBe('');
            } else {
              // Unlit: a solid hairline outline, never dashed and never faded.
              expect(tick.style.borderTopWidth, name).toBe(`${String(rule.hairline)}px`);
              expect(tick.style.borderTopColor, name).toBe(written(color[theme].textSecondary));
              expect(tick.style.borderTopStyle, name).not.toBe('dashed');
              expect(tick.style.borderTopStyle, name).not.toBe('dotted');
              expect(tick.style.opacity, name).toBe('');
            }
          });
          expect(center.textContent, name).toBe(count);
          expect(ring.textContent, name).toBe(count);
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.twelve).toEqual({ daysLeft: 12 });
    expect(STATES.five).toEqual({ daysLeft: 5 });
    expect(STATES.zero).toEqual({ daysLeft: 0 });
    expect(STATES.fortyTwo).toEqual({ daysLeft: 42 });
    expect(STATES.size120).toEqual({ daysLeft: 12, size: 120 });
    expect(STATES.withMotion).toEqual({ daysLeft: 12, itemKey: 'fixture-deadline-ring' });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const ring = draw(ALL[state]);
      // Decoration: no role and no name, on the ring or on anything in it.
      for (const part of [ring, ...ring.querySelectorAll<HTMLElement>('*')]) {
        expect(part.getAttribute('role'), state).toBeNull();
        expect(part.getAttribute('aria-label'), state).toBeNull();
        expect(part.getAttribute('tabindex'), state).toBeNull();
      }
    }
  });

  it('has a testID', () => {
    // The ring takes no id: the block that holds it carries one, and the ring is found through it.
    for (const state of STATE_NAMES) {
      draw(ALL[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    // A ring that is not seen for the first time is still, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        if (state === 'withMotion') continue;
        const ring = draw(ALL[state], { reducedMotion });
        for (const part of [ring, ...ring.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }

    // Seen for the first time under reduced motion, the lit ticks fade in together: none waits its turn.
    clearOncePerItem();
    const { ticks, center } = partsOf(draw(STATES.withMotion, { reducedMotion: true }));
    const placed = ticks.map((tick) => tick.style.transform);
    act(() => {
      vi.advanceTimersByTime(motion.duration.ringStagger + FRAME_SLACK_MS);
    });
    const together = ticks.filter(isLit).map(opacityOf);
    expect(together).toHaveLength(EXPECTED.withMotion.lit);
    expect(new Set(together).size).toBe(1);
    expect(together[0]).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(motion.duration.ringStagger * size.ring.ticks);
    });
    expect(ticks.map(opacityOf)).toEqual(ticks.map(() => 1));
    // Opacity only: no tick has moved, and the count never does.
    expect(ticks.map((tick) => tick.style.transform)).toEqual(placed);
    expect(center.style.transform).toBe('');
    expect(center.style.opacity).toBe('');
  });

  it('shows not known yet', () => {
    // The ring has no unknown state: a window nobody knows draws no ring at all (C-DeadlineBlock).
    // With no days left it lights nothing and says 0: never a negative count and never a blank.
    for (const daysLeft of [0, -3]) {
      const ring = draw({ daysLeft });
      const { ticks, center } = partsOf(ring);
      expect(ticks.filter(isLit), String(daysLeft)).toHaveLength(0);
      expect(center.textContent, String(daysLeft)).toBe('0');
      expect(ring.textContent, String(daysLeft)).not.toContain('not known yet');
    }
  });

  it("thirty ticks from twelve o'clock", () => {
    for (const state of ['twelve', 'size120'] as const) {
      const { ticks } = partsOf(draw(ALL[state]));
      expect(ticks, state).toHaveLength(30);
      expect(turnOf(ticks[0] as HTMLElement), state).toBe(0);
      expect(turnOf(ticks[3] as HTMLElement), state).toBe(36);
      // Clockwise, twelve degrees apart, all the way round.
      ticks.forEach((tick, index) => {
        expect(turnOf(tick), state).toBeCloseTo(index * 12);
        // Turned first, then moved out along its own axis: tick 0 stands straight up.
        expect(tick.style.transform, state).toMatch(/^rotate\([^)]+\) translateY\(-[^)]+\)$/);
      });
      // Every tick stands the same distance out, so they form a circle.
      expect(new Set(ticks.map(reachOf)).size, state).toBe(1);
    }
  });

  it('lit ticks are the days left', () => {
    const lit = (daysLeft: number): boolean[] => partsOf(draw({ daysLeft })).ticks.map(isLit);
    expect(lit(12).filter(Boolean)).toHaveLength(12);
    expect(lit(42).filter(Boolean)).toHaveLength(30);
    expect(lit(0).filter(Boolean)).toHaveLength(0);
    expect(lit(30).filter(Boolean)).toHaveLength(30);
    expect(lit(1).filter(Boolean)).toHaveLength(1);
    // The lit ticks are the first ones, clockwise from twelve o'clock.
    expect(lit(5)).toEqual(Array.from({ length: 30 }, (_, index) => index < 5));
    // The ring never changes color as the days run out.
    const soon = partsOf(draw({ daysLeft: 5 })).ticks[0];
    const later = partsOf(draw({ daysLeft: 12 })).ticks[0];
    expect(soon?.style.backgroundColor).toBe(later?.style.backgroundColor);
  });

  it('the count in the center', () => {
    const { center } = partsOf(draw(STATES.twelve));
    const count = center.firstElementChild;
    if (!(count instanceof HTMLElement)) {
      throw new Error('the ring draws no count');
    }
    expect(count.textContent).toBe('12');
    const style = typography.numeralTitle.style;
    expect(count.style.fontFamily).toContain(String(style.fontFamily));
    expect(parseFloat(count.style.fontSize)).toBeCloseTo(style.fontSize ?? 0);
    expect(count.style.color).toBe(written(color.light.text));
    // Centered over the whole box.
    expect(center.style.position).toBe('absolute');
    expect(center.style.alignItems).toBe('center');
    expect(center.style.justifyContent).toBe('center');
    // The count is the days themselves, past the thirty the ticks can show.
    expect(partsOf(draw(STATES.fortyTwo)).center.textContent).toBe('42');
  });

  it('hidden from screen readers', () => {
    for (const state of STATE_NAMES) {
      const ring = draw(ALL[state]);
      expect(ring.getAttribute('aria-hidden'), state).toBe('true');
      // The whole ring: the count is inside the hidden box.
      expect(ring.textContent, state).toBe(EXPECTED[state].count);
    }
  });

  it('never smaller than 96', () => {
    expect(size.deadlineRingMin).toBe(96);
    // React reports the throw on the console as well; the case reads the throw itself.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => draw({ daysLeft: 12, size: 80 })).toThrow(/never smaller/);
    expect(() => draw({ daysLeft: 12, size: 95 })).toThrow(/never smaller/);
    errors.mockRestore();
    expect(() => draw({ daysLeft: 12, size: 96 })).not.toThrow();
  });

  it('only lit ticks animate, once', () => {
    vi.useFakeTimers();
    clearOncePerItem();
    const first = partsOf(draw(STATES.withMotion)).ticks;
    const lit = EXPECTED.withMotion.lit;
    // The lit ticks start off; the unlit ones carry no motion at all.
    first.forEach((tick, index) => {
      expect(tick.style.opacity, String(index)).toBe(index < lit ? '0' : '');
    });
    // They cut on clockwise, one every 20 ms: the first is on while the last still waits.
    act(() => {
      vi.advanceTimersByTime(motion.duration.ringStagger + FRAME_SLACK_MS);
    });
    expect(opacityOf(first[0] as HTMLElement)).toBe(1);
    expect(opacityOf(first[lit - 1] as HTMLElement)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(motion.duration.ringStagger * size.ring.ticks + FRAME_SLACK_MS);
    });
    expect(first.map(opacityOf)).toEqual(first.map(() => 1));

    // The same item again is drawn whole at once.
    for (const tick of partsOf(draw(STATES.withMotion)).ticks) {
      expect(tick.style.opacity).toBe('');
    }
    // A ring without a key never plays.
    clearOncePerItem();
    for (const tick of partsOf(draw(STATES.twelve)).ticks) {
      expect(tick.style.opacity).toBe('');
    }
  });
});
