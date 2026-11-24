import { cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

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
