import { cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';

import { CountBadge } from './count-badge';
import type { CountBadgeProps } from './count-badge';
import { GROUND, PREVIEW, STATES } from './count-badge.fixtures';
import { InteractionPreview } from './pressable';

// The props each View receives, so the cases below can read what a phone's screen reader is told:
// the web drops those props before they reach the page.
const views = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>();
  return {
    ...actual,
    View: (props: ReactNative.ViewProps): ReactElement => {
      views.props.push({ ...props });
      return createElement(actual.View, props);
    },
  };
});

// The text size of the system, which only a phone reports: 1 unless a case sets it.
const system = vi.hoisted(() => {
  const state: { fontScale: number } = { fontScale: 1 };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout =>
      actual.layoutFor({ width: 360, height: 740, fontScale: system.fontScale, topBarHeight: 0 }),
  };
});

const STATE_NAMES = ['one', 'nine', 'ninetyNine', 'overflow', 'zero', 'row'] as const;

type Drawn = {
  /** The view that hides the badge from screen readers; null when nothing is drawn. */
  hidden: HTMLElement | null;
  /** The ink pill. */
  pill: HTMLElement | null;
  /** The digits. */
  digits: HTMLElement | null;
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one badge, in place of whatever was drawn before, and finds its parts. */
function draw(props: CountBadgeProps, options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  views.props = [];
  const view = renderWithProviders(<CountBadge {...props} />, options);
  const hidden = view.container.querySelector<HTMLElement>('[aria-hidden="true"]');
  const pill = hidden?.firstElementChild ?? null;
  const digits = pill?.firstElementChild ?? null;
  return {
    hidden,
    pill: pill instanceof HTMLElement ? pill : null,
    digits: digits instanceof HTMLElement ? digits : null,
  };
}

afterEach(() => {
  system.fontScale = 1;
});

describe('CountBadge', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <CountBadge {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        expect(view.container.textContent !== '', state).toBe(state !== 'zero');
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the six states', () => {
    expect(STATES).toEqual({
      one: { count: 1 },
      nine: { count: 9 },
      ninetyNine: { count: 99 },
      overflow: { count: 100 },
      zero: { count: 0 },
      row: { count: 14, size: 'row' },
    });
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    // A badge takes no presses and is hidden: the control it sits on carries the count in its name.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(
        document.querySelectorAll('a, button, [role], [tabindex], [aria-label]'),
        state,
      ).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    // Nothing in a badge is interactive, so nothing carries an id.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      cleanup();
      const view = renderWithProviders(
        <InteractionPreview state={{ pressed: true }}>
          <CountBadge {...STATES[state]} />
        </InteractionPreview>,
        { reducedMotion: true },
      );
      for (const element of view.container.querySelectorAll<HTMLElement>('*')) {
        expect(element.style.transform, state).toBe('');
        expect(element.style.transitionProperty, state).toBe('');
      }
    }
  });

  it('a count of zero renders nothing', () => {
    const zero = draw(STATES.zero);
    expect(zero.hidden).toBeNull();
    expect(document.body.textContent).toBe('');
    // Neither does a count below zero, or one that is not a number.
    expect(draw({ count: -3 }).hidden).toBeNull();
    expect(draw({ count: Number.NaN }).hidden).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it('counts to 99 and then reads 99+', () => {
    expect(draw(STATES.one).digits?.textContent).toBe('1');
    expect(draw(STATES.nine).digits?.textContent).toBe('9');
    expect(draw(STATES.ninetyNine).digits?.textContent).toBe('99');
    expect(draw(STATES.overflow).digits?.textContent).toBe('99+');
    expect(draw({ count: 12000 }).digits?.textContent).toBe('99+');
    expect(draw(STATES.row).digits?.textContent).toBe('14');
  });

  it('the corner badge is 16 points high and the row badge 20, each at least as wide', () => {
    const corner = draw(STATES.one).pill;
    expect(corner?.style.minHeight).toBe('16px');
    expect(corner?.style.minWidth).toBe('16px');
    const row = draw(STATES.row).pill;
    expect(row?.style.minHeight).toBe('20px');
    expect(row?.style.minWidth).toBe('20px');
    // Nothing fixes the height, so the digits can grow with the text size.
    expect(row?.style.height).toBe('');
    expect(row?.style.paddingLeft).toBe('4px');
    expect(row?.style.paddingRight).toBe('4px');
  });

  it('a single digit stays a circle as the text grows', () => {
    // At 130% the line of the count is 20.8 points high, and the badge is as wide.
    for (const state of ['one', 'nine'] as const) {
      const { pill, digits } = draw(STATES[state], { textScale: 1.3 });
      expect(digits?.style.lineHeight, state).toBe('20.8px');
      expect(pill?.style.minHeight, state).toBe('20.8px');
      expect(pill?.style.minWidth, state).toBe('20.8px');
      expect(pill?.style.height, state).toBe('');
    }
    // The row badge keeps its 20 points until the line passes them.
    const row = draw(STATES.row, { textScale: 1.2 }).pill;
    expect(row?.style.minHeight).toBe('20px');
    expect(row?.style.minWidth).toBe('20px');
    const tallRow = draw(STATES.row, { textScale: 1.5 }).pill;
    expect(tallRow?.style.minHeight).toBe('24px');
    expect(tallRow?.style.minWidth).toBe('24px');
  });

  it('on a phone the badge follows the text size of the system', () => {
    // A phone scales the 16-point line itself: at 130% it is 20.8 points, at 200% it is 32.
    system.fontScale = 1.3;
    const corner = draw(STATES.one).pill;
    expect(corner?.style.minHeight).toBe('20.8px');
    expect(corner?.style.minWidth).toBe('20.8px');
    system.fontScale = 2;
    const large = draw(STATES.nine).pill;
    expect(large?.style.minHeight).toBe('32px');
    expect(large?.style.minWidth).toBe('32px');
    const row = draw(STATES.row).pill;
    expect(row?.style.minHeight).toBe('32px');
    expect(row?.style.minWidth).toBe('32px');
  });

  it('is a round ink pill with mono digits in fixed-width figures', () => {
    const { pill, digits } = draw(STATES.ninetyNine);
    expect(pill?.style.borderRadius).toBe('9999px');
    expect(pill?.style.backgroundColor).toBe(written('#141412'));
    expect(digits?.style.color).toBe(written('#F3F1EA'));
    expect(digits?.style.fontFamily).toBe('ChivoMono-Medium');
    expect(digits?.style.fontVariant).toBe('tabular-nums');

    const dark = draw(STATES.ninetyNine, { theme: 'dark' });
    expect(dark.pill?.style.backgroundColor).toBe(written('#F3F1EA'));
    expect(dark.digits?.style.color).toBe(written('#141412'));
  });

  it('is hidden from screen readers', () => {
    for (const state of ['one', 'nine', 'ninetyNine', 'overflow', 'row'] as const) {
      const { hidden, pill } = draw(STATES[state]);
      expect(hidden?.getAttribute('aria-hidden'), state).toBe('true');
      expect(hidden?.contains(pill), state).toBe(true);
      // What hides it on phones.
      const hiddenProps = views.props.find((props) => props['aria-hidden'] === true);
      expect(hiddenProps?.accessibilityElementsHidden, state).toBe(true);
      expect(hiddenProps?.importantForAccessibility, state).toBe('no-hide-descendants');
    }
  });

  it('stays as wide as its digits wherever it is placed', () => {
    const { hidden } = draw(STATES.one);
    expect(hidden?.style.flexDirection).toBe('row');
    expect(hidden?.style.alignItems).toBe('center');
    expect(window.getComputedStyle(hidden ?? document.body).pointerEvents).toBe('none');
  });
});
