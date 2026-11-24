import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  clearOncePerItem,
  ReducedMotionOverride,
  useFade,
  useOncePerItem,
  usePressMotion,
  usePulse,
  useReducedMotion,
  useRise,
  useSpringScale,
  useStagger,
  useStamp,
} from './motion';

function under(reduced: boolean) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ReducedMotionOverride value={reduced}>{children}</ReducedMotionOverride>;
  };
}

/** The fields of a style object the CSS-transition hooks return. */
function fields(style: unknown): Record<string, unknown> {
  if (typeof style !== 'object' || style === null || Array.isArray(style)) {
    throw new Error('expected one style object');
  }
  return style as Record<string, unknown>; // checked to be a plain object just above
}

describe('motion hooks', () => {
  it('the override wins', () => {
    expect(renderHook(() => useReducedMotion(), { wrapper: under(true) }).result.current).toBe(
      true,
    );
    expect(renderHook(() => useReducedMotion(), { wrapper: under(false) }).result.current).toBe(
      false,
    );
  });

  it('press motion moves and returns', () => {
    const { result } = renderHook(() => usePressMotion(), { wrapper: under(false) });
    expect(result.current.isPressed).toBe(false);
    act(() => {
      result.current.handlers.onPressIn();
    });
    expect(result.current.isPressed).toBe(true);
    const pressed = fields(result.current.style);
    expect(pressed.transform).toEqual([{ translateY: 1 }, { scale: 0.98 }]);
    expect(pressed.transitionDuration).toBe(90);
    expect(pressed.transitionProperty).toBe('transform');
    expect(result.current.swapsFill).toBe(false);
    act(() => {
      result.current.handlers.onPressOut();
    });
    expect(result.current.isPressed).toBe(false);
    expect(fields(result.current.style).transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
  });

  it('press motion under reduced motion swaps instead of moving', () => {
    const { result } = renderHook(() => usePressMotion(), { wrapper: under(true) });
    act(() => {
      result.current.handlers.onPressIn();
    });
    expect(result.current.isPressed).toBe(true);
    expect(fields(result.current.style).transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
    expect(result.current.swapsFill).toBe(true);

    const forced = renderHook(() => usePressMotion(true), { wrapper: under(true) });
    expect(forced.result.current.isPressed).toBe(true);
    expect(forced.result.current.swapsFill).toBe(true);

    const forcedMoving = renderHook(() => usePressMotion(true), { wrapper: under(false) });
    expect(forcedMoving.result.current.isPressed).toBe(true);
    expect(forcedMoving.result.current.swapsFill).toBe(false);
    expect(fields(forcedMoving.result.current.style).transform).toEqual([
      { translateY: 1 },
      { scale: 0.98 },
    ]);
  });

  it('rise and fade use only transform and opacity', () => {
    const rise = fields(
      renderHook(() => useRise(true, 6, 180), { wrapper: under(false) }).result.current,
    );
    expect(rise.transitionProperty).toEqual(['opacity', 'transform']);
    expect(rise.transitionDuration).toBe(180);
    expect(rise.opacity).toBe(1);
    expect(rise.transform).toEqual([{ translateY: 0 }]);
    const waiting = fields(
      renderHook(() => useRise(false, 6, 180), { wrapper: under(false) }).result.current,
    );
    expect(waiting.opacity).toBe(0);
    expect(waiting.transform).toEqual([{ translateY: 6 }]);

    const reduced = fields(
      renderHook(() => useRise(true, 6, 180), { wrapper: under(true) }).result.current,
    );
    expect(reduced.transitionProperty).toBe('opacity');
    expect(reduced.transitionDuration).toBe(120);
    expect(reduced.transform).toBeUndefined();

    const fade = fields(renderHook(() => useFade(false), { wrapper: under(false) }).result.current);
    expect(fade.opacity).toBe(0);
    expect(fade.transitionDuration).toBe(120);
    expect(fade.transitionProperty).toBe('opacity');
    expect(
      fields(renderHook(() => useFade(true, 150), { wrapper: under(false) }).result.current)
        .transitionDuration,
    ).toBe(150);
  });

  it('once per item', () => {
    clearOncePerItem();
    const firstItem: { id: string | undefined } = { id: 'fixture-1' };
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useOncePerItem('meters', id),
      { initialProps: firstItem },
    );
    expect(result.current.shouldPlay).toBe(true);
    act(() => {
      result.current.markPlayed();
    });
    rerender({ id: 'fixture-1' });
    expect(result.current.shouldPlay).toBe(false);
    // Another kind keeps its own record.
    expect(renderHook(() => useOncePerItem('ring', 'fixture-1')).result.current.shouldPlay).toBe(
      true,
    );
    rerender({ id: undefined });
    expect(result.current.shouldPlay).toBe(false);
    clearOncePerItem();
    rerender({ id: 'fixture-1' });
    expect(result.current.shouldPlay).toBe(true);
  });

  it('worklet hooks mount', () => {
    const notPlayed: { k: number | null } = { k: null };
    for (const reduced of [false, true]) {
      const stamp = renderHook(
        ({ k }: { k: number | null }) => useStamp(k, { scale: 1.08, rotateDeg: 2 }),
        {
          wrapper: under(reduced),
          initialProps: notPlayed,
        },
      );
      stamp.rerender({ k: 1 });
      const spring = renderHook(({ k }: { k: number | null }) => useSpringScale(k, 1.15), {
        wrapper: under(reduced),
        initialProps: notPlayed,
      });
      spring.rerender({ k: 1 });
      const stagger = renderHook(() => useStagger(10, 40, true), { wrapper: under(reduced) });
      expect(typeof stagger.result.current).toBe('function');
      expect(stagger.result.current(9)).toBeDefined();
      const pulse = renderHook(() => usePulse(true), { wrapper: under(reduced) });
      expect(pulse.result.current).toBeDefined();
      for (const hook of [stamp, spring, stagger, pulse]) {
        hook.unmount();
      }
    }
  });
});
