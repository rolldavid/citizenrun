import { act, cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { InteractionPreview } from './pressable';
import { Rule } from './rule';
import type { RuleProps } from './rule';
import { GROUND, PREVIEW, STATES } from './rule.fixtures';

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

const STATE_NAMES = ['strong', 'soft', 'strongGutter', 'softGutter'] as const;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

const INITIAL_INNER_WIDTH = window.innerWidth;

/**
 * Sets the window's width. The web's window dimensions come from the document element, which
 * jsdom, with no layout, reports as 0 wide; `undefined` puts that back.
 */
function setWindowWidth(width: number | undefined): void {
  const root = document.documentElement;
  if (width === undefined) {
    Reflect.deleteProperty(root, 'clientWidth');
    window.innerWidth = INITIAL_INNER_WIDTH;
  } else {
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: width });
    window.innerWidth = width;
  }
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

/** Renders one rule, in place of whatever was drawn before, and returns its element. */
function draw(props: RuleProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  views.props = [];
  const view = renderWithProviders(<Rule {...props} />, options);
  const rules = view.container.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
  const [element] = rules;
  if (rules.length !== 1 || element === undefined) {
    throw new Error(`expected one rule, found ${String(rules.length)}`);
  }
  return element;
}

/** The props C-Rule gave its view. */
function ruleProps(): Record<string, unknown> {
  const found = views.props.find((props) => props['aria-hidden'] === true);
  if (found === undefined) {
    throw new Error('no view is hidden from screen readers');
  }
  return found;
}

afterEach(() => {
  setWindowWidth(undefined);
});

describe('Rule', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <Rule {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        expect(view.container.querySelectorAll('[aria-hidden="true"]'), state).toHaveLength(1);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the four states', () => {
    expect(STATES).toEqual({
      strong: { variant: 'strong' },
      soft: { variant: 'soft' },
      strongGutter: { variant: 'strong', inset: 'gutter' },
      softGutter: { variant: 'soft', inset: 'gutter' },
    });
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    // A rule is decoration: it takes no presses, so it has neither, and no state draws a control.
    for (const state of STATE_NAMES) {
      const element = draw(STATES[state]);
      expect(element.getAttribute('role'), state).toBeNull();
      expect(element.getAttribute('aria-label'), state).toBeNull();
      expect(document.querySelectorAll('a, button, [role], [tabindex]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    // Nothing in a rule is interactive, so nothing carries an id.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
      expect(screen.queryAllByRole('button'), state).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      cleanup();
      const view = renderWithProviders(
        <InteractionPreview state={{ pressed: true }}>
          <Rule {...STATES[state]} />
        </InteractionPreview>,
        { reducedMotion: true },
      );
      for (const element of view.container.querySelectorAll<HTMLElement>('*')) {
        expect(element.style.transform, state).toBe('');
        expect(element.style.transitionProperty, state).toBe('');
      }
    }
  });

  it('strong is one point of rule and soft one point of ruleSoft', () => {
    const strong = draw(STATES.strong);
    expect(strong.style.height).toBe('1px');
    expect(strong.style.backgroundColor).toBe(written('#141412'));
    expect(draw(STATES.strong, { theme: 'dark' }).style.backgroundColor).toBe(written('#A9A69B'));

    const soft = draw(STATES.soft);
    expect(soft.style.height).toBe('1px');
    expect(soft.style.backgroundColor).toBe(written('#D5D2C7'));
    expect(draw(STATES.soft, { theme: 'dark' }).style.backgroundColor).toBe(written('#33332E'));
  });

  it('is hidden from screen readers', () => {
    for (const state of STATE_NAMES) {
      const element = draw(STATES[state]);
      expect(element.getAttribute('aria-hidden'), state).toBe('true');
      expect(element.childElementCount, state).toBe(0);
      // What hides it on phones.
      expect(ruleProps().accessibilityElementsHidden, state).toBe(true);
      expect(ruleProps().importantForAccessibility, state).toBe('no-hide-descendants');
    }
  });

  it('runs the full width unless inset', () => {
    for (const state of ['strong', 'soft'] as const) {
      const element = draw(STATES[state]);
      expect(element.style.alignSelf, state).toBe('stretch');
      expect(element.style.marginLeft, state).toBe('0px');
      expect(element.style.marginRight, state).toBe('0px');
    }
  });

  it('the gutter inset is 16 points on a narrow phone and 24 from 380 up', () => {
    setWindowWidth(360);
    for (const state of ['strongGutter', 'softGutter'] as const) {
      const element = draw(STATES[state]);
      expect(element.style.marginLeft, state).toBe('16px');
      expect(element.style.marginRight, state).toBe('16px');
    }
    setWindowWidth(430);
    for (const state of ['strongGutter', 'softGutter'] as const) {
      const element = draw(STATES[state]);
      expect(element.style.marginLeft, state).toBe('24px');
      expect(element.style.marginRight, state).toBe('24px');
    }
    // A rule already on the screen follows the window.
    const live = draw(STATES.strongGutter);
    setWindowWidth(360);
    expect(live.style.marginLeft).toBe('16px');
  });
});
