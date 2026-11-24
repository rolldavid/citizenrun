import { screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ICON_NAMES, ICONS } from '@/ui/icons';
import { ToneContext } from '@/ui/tone';

import { Icon } from './icon';
import type { IconProps } from './icon';
import { GROUND, PREVIEW, STATES } from './icon.fixtures';

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

const SET = [
  'home',
  'homeFilled',
  'explore',
  'exploreFilled',
  'plus',
  'activity',
  'activityFilled',
  'profile',
  'profileFilled',
  'messages',
  'messagesFilled',
  'heart',
  'heartFilled',
  'comment',
  'repost',
  'share',
  'bookmark',
  'bookmarkFilled',
  'play',
  'playFilled',
  'sound',
  'mute',
  'back',
  'chevronRight',
  'chevronDown',
  'more',
  'close',
  'check',
  'arrow',
  'send',
  'minus',
  'search',
  'filter',
  'settings',
  'edit',
  'trash',
  'lock',
  'link',
  'tag',
  'camera',
  'image',
  'map',
  'grid',
  'layers',
  'near',
  'pin',
  'globe',
  'calendar',
  'info',
  'warning',
  'error',
  'report',
  'block',
  'star',
  'starFilled',
  'qr',
] as const;

const FURTHER_STATES = ['small', 'medium', 'secondary', 'danger', 'inverse', 'labelled'] as const;

type ThemeName = 'light' | 'dark';

type Drawn = {
  /** The view the glyph sits in. */
  box: HTMLElement;
  svg: SVGSVGElement;
  path: SVGPathElement;
  /** The props C-Icon gave that view. */
  boxProps: Record<string, unknown>;
  unmount: () => void;
};

/** Renders one icon and finds its parts. The element holds exactly one C-Icon. */
function drawElement(ui: ReactElement, theme: ThemeName = 'light'): Drawn {
  views.props = [];
  const view = renderWithProviders(ui, { theme });
  const svgs = view.container.querySelectorAll('svg');
  const [svg] = svgs;
  if (svgs.length !== 1 || svg === undefined) {
    throw new Error(`expected one svg, found ${String(svgs.length)}`);
  }
  const paths = svg.querySelectorAll('path');
  const [path] = paths;
  if (paths.length !== 1 || path === undefined) {
    throw new Error(`expected one path, found ${String(paths.length)}`);
  }
  const box = svg.parentElement;
  if (box === null) {
    throw new Error('the glyph has no view around it');
  }
  const boxProps = views.props.find((props) => props.pointerEvents === 'none');
  if (boxProps === undefined) {
    throw new Error('no view takes the glyph out of pointer events');
  }
  return { box, svg, path, boxProps, unmount: view.unmount };
}

function draw(props: IconProps, theme: ThemeName = 'light'): Drawn {
  return drawElement(<Icon {...props} />, theme);
}

describe('Icon', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const props of Object.values(STATES)) {
        const drawn = draw(props, theme);
        expect(drawn.svg.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(drawn.path.getAttribute('d')).toMatch(/^M/);
        drawn.unmount();
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold every icon and the six further states', () => {
    expect(Object.keys(STATES)).toEqual([...SET, ...FURTHER_STATES]);
    for (const name of SET) {
      expect(STATES[name]).toEqual({ name });
    }
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({ inverse: 'inverseBg' });
  });

  it("the set is exactly C-Icon's 56 names", () => {
    expect(SET).toHaveLength(56);
    expect(Object.keys(ICONS)).toEqual([...SET]);
    expect(ICON_NAMES).toEqual([...SET]);
  });

  it('path data equals the reference', () => {
    expect(draw({ name: 'home' }).path.getAttribute('d')).toBe('M4 11 12 4l8 7v9H4z');
    expect(draw({ name: 'chevronRight' }).path.getAttribute('d')).toBe('M9 5l7 7-7 7');
    const more = draw({ name: 'more' }).path;
    expect(more.getAttribute('d')).toBe('M5 12h.01M12 12h.01M19 12h.01');
    expect(more.getAttribute('stroke-width')).toBe('2.6');
    expect(draw({ name: 'starFilled' }).path.getAttribute('d')).toBe(
      'M12 3.500l2.600 5.600 6 .700-4.500 4.100 1.200 6-5.300-3-5.300 3 1.200-6L3.400 9.800l6-.700z',
    );
  });

  it('outline and filled forms', () => {
    const heart = draw({ name: 'heart' }).path;
    expect(heart.getAttribute('fill')).toBe('none');
    expect(heart.getAttribute('stroke')).toBe('#141412');
    const filled = draw({ name: 'heartFilled' }).path;
    expect(filled.getAttribute('fill')).toBe('#141412');
    expect(filled.getAttribute('stroke')).toBe('#141412');
    for (const path of [heart, filled]) {
      expect(path.getAttribute('stroke-linecap')).toBe('square');
      expect(path.getAttribute('stroke-linejoin')).toBe('miter');
    }
    const dark = draw({ name: 'heartFilled' }, 'dark').path;
    expect(dark.getAttribute('fill')).toBe('#F3F1EA');
    expect(dark.getAttribute('stroke')).toBe('#F3F1EA');
  });

  it('only the Filled names are filled, and every shape keeps its cuts', () => {
    for (const name of SET) {
      const drawn = draw({ name });
      expect(drawn.path.getAttribute('fill') !== 'none', name).toBe(name.endsWith('Filled'));
      expect(drawn.path.getAttribute('fill-rule'), name).toBe('evenodd');
      drawn.unmount();
    }
  });

  it('every icon but more has the 2-unit stroke', () => {
    for (const name of SET) {
      const drawn = draw({ name });
      expect(drawn.path.getAttribute('stroke-width'), name).toBe(name === 'more' ? '2.6' : '2');
      drawn.unmount();
    }
  });

  it('sizes', () => {
    const cases = [
      [STATES.small, '16'],
      [STATES.medium, '20'],
      [STATES.heart, '24'],
    ] as const;
    for (const [props, points] of cases) {
      const drawn = draw(props);
      expect(drawn.svg.getAttribute('width')).toBe(points);
      expect(drawn.svg.getAttribute('height')).toBe(points);
      const box = window.getComputedStyle(drawn.box);
      expect(box.width).toBe(`${points}px`);
      expect(box.height).toBe(`${points}px`);
      drawn.unmount();
    }
  });

  it('tones', () => {
    expect(draw(STATES.secondary).path.getAttribute('stroke')).toBe('#535148');
    expect(draw(STATES.secondary, 'dark').path.getAttribute('stroke')).toBe('#A9A69B');
    expect(draw(STATES.danger).path.getAttribute('stroke')).toBe('#B3202A');
    // The inverse specimen sits on inverseBg, so it draws in the ground's text color.
    expect(draw(STATES.inverse).path.getAttribute('stroke')).toBe('#F3F1EA');
    expect(draw(STATES.inverse, 'dark').path.getAttribute('stroke')).toBe('#141412');
  });

  it('inherit takes the tone of the text around it', () => {
    const inText = drawElement(
      <ToneContext.Provider value="danger">
        <Icon name="error" />
      </ToneContext.Provider>,
    );
    expect(inText.path.getAttribute('stroke')).toBe('#B3202A');
    // Outside any text the icon draws in `text`.
    expect(draw({ name: 'error' }).path.getAttribute('stroke')).toBe('#141412');
    expect(draw({ name: 'error' }, 'dark').path.getAttribute('stroke')).toBe('#F3F1EA');
    // A tone of its own wins over the text's.
    const own = drawElement(
      <ToneContext.Provider value="danger">
        <Icon name="info" tone="secondary" />
      </ToneContext.Provider>,
    );
    expect(own.path.getAttribute('stroke')).toBe('#535148');
  });

  it('has a label and a role, or is hidden', () => {
    const labelled = draw(STATES.labelled);
    expect(screen.getByRole('img', { name: 'Warning' })).toBe(labelled.box);
    expect(labelled.box.getAttribute('aria-hidden')).toBeNull();
    expect(labelled.boxProps.accessible).toBe(true);
    expect(labelled.boxProps.accessibilityElementsHidden).toBeUndefined();
    labelled.unmount();

    for (const [state, props] of Object.entries(STATES)) {
      if (state === 'labelled') {
        continue;
      }
      const drawn = draw(props);
      expect(drawn.box.getAttribute('aria-hidden'), state).toBe('true');
      expect(drawn.box.getAttribute('role'), state).toBeNull();
      expect(drawn.box.getAttribute('aria-label'), state).toBeNull();
      expect(screen.queryByRole('img'), state).toBeNull();
      // What hides it on phones.
      expect(drawn.boxProps.accessibilityElementsHidden, state).toBe(true);
      expect(drawn.boxProps.importantForAccessibility, state).toBe('no-hide-descendants');
      expect(drawn.boxProps.accessible, state).toBeUndefined();
      drawn.unmount();
    }
  });

  it('takes no pointer events', () => {
    for (const props of [STATES.heart, STATES.labelled]) {
      const drawn = draw(props);
      expect(window.getComputedStyle(drawn.box).pointerEvents).toBe('none');
      expect(drawn.box.getAttribute('tabindex')).toBeNull();
      drawn.unmount();
    }
  });
});
