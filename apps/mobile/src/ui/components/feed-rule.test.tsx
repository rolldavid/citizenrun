import { act, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { FeedRule } from './feed-rule';
import { GROUND, PREVIEW, STATES } from './feed-rule.fixtures';
import { InteractionPreview } from './pressable';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// The feed rule loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('the feed rule loads no asset');
  },
}));

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

type Drawn = { box: HTMLElement; svg: SVGSVGElement; line: SVGLineElement };

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

/** Renders the feed rule, in place of whatever was drawn before, and finds its parts. */
function draw(options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  views.props = [];
  const view = renderWithProviders(<FeedRule {...STATES.default} />, options);
  const svgs = view.container.querySelectorAll('svg');
  const [svg] = svgs;
  if (svgs.length !== 1 || svg === undefined) {
    throw new Error(`expected one svg, found ${String(svgs.length)}`);
  }
  const lines = svg.querySelectorAll('line');
  const [line] = lines;
  if (lines.length !== 1 || line === undefined || svg.childElementCount !== 1) {
    throw new Error(`expected one line and nothing else, found ${String(lines.length)}`);
  }
  const box = svg.parentElement;
  if (box === null) {
    throw new Error('the line has no view around it');
  }
  return { box, svg, line };
}

afterEach(() => {
  setWindowWidth(undefined);
});

describe('FeedRule', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const [state, props] of Object.entries(STATES)) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state as keyof typeof STATES] ?? {}}>
            <FeedRule {...props} />
          </InteractionPreview>,
          { theme },
        );
        expect(view.container.querySelectorAll('line'), state).toHaveLength(1);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the one state', () => {
    expect(STATES).toEqual({ default: {} });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    // The feed rule is decoration: it takes no presses, so it has neither.
    const { box } = draw();
    expect(box.getAttribute('role')).toBeNull();
    expect(box.getAttribute('aria-label')).toBeNull();
    expect(document.querySelectorAll('a, button, [role], [tabindex]')).toHaveLength(0);
  });

  it('has a testID', () => {
    // Nothing in the feed rule is interactive, so nothing carries an id.
    draw();
    expect(document.querySelectorAll('[data-testid]')).toHaveLength(0);
  });

  it('respects reduced motion', () => {
    cleanup();
    const view = renderWithProviders(
      <InteractionPreview state={{ pressed: true }}>
        <FeedRule />
      </InteractionPreview>,
      { reducedMotion: true },
    );
    for (const element of view.container.querySelectorAll<HTMLElement>('div')) {
      expect(element.style.transform).toBe('');
      expect(element.style.transitionProperty).toBe('');
    }
    expect(view.container.querySelector('line')?.getAttribute('transform')).toBeNull();
  });

  it('one dashed line draws 2-point squares on a 6-point pitch', () => {
    const { svg, line } = draw();
    expect(line.getAttribute('stroke-dasharray')).toBe('2,4');
    expect(line.getAttribute('stroke-width')).toBe('2');
    expect(line.getAttribute('stroke-linecap')).toBe('butt');
    // The line runs the whole width, through the middle of a strip as high as a square.
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('2');
    expect(line.getAttribute('x1')).toBe('0');
    expect(line.getAttribute('x2')).toBe('100%');
    expect(line.getAttribute('y1')).toBe('1');
    expect(line.getAttribute('y2')).toBe('1');
  });

  it('is drawn in rule', () => {
    expect(draw().line.getAttribute('stroke')).toBe('#141412');
    expect(draw({ theme: 'dark' }).line.getAttribute('stroke')).toBe('#A9A69B');
  });

  it('is hidden from screen readers and takes no pointer', () => {
    const { box } = draw();
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(window.getComputedStyle(box).pointerEvents).toBe('none');
    // What hides it on phones.
    const boxProps = views.props.find((props) => props['aria-hidden'] === true);
    expect(boxProps?.accessibilityElementsHidden).toBe(true);
    expect(boxProps?.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('is inset by the gutter on a phone and by nothing in the wide feed column', () => {
    setWindowWidth(360);
    expect(draw().box.style.paddingLeft).toBe('16px');
    expect(draw().box.style.paddingRight).toBe('16px');
    setWindowWidth(430);
    expect(draw().box.style.paddingLeft).toBe('24px');
    expect(draw().box.style.paddingRight).toBe('24px');
    for (const width of [820, 1440]) {
      setWindowWidth(width);
      expect(draw().box.style.paddingLeft, String(width)).toBe('0px');
      expect(draw().box.style.paddingRight, String(width)).toBe('0px');
    }
  });
});
