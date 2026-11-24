import { fontCovers } from '@citizenrun/shared';
import { cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { Text } from './text';
import type { TextProps, TextTone } from './text';
import { GROUND, PREVIEW, STATES } from './text.fixtures';

// The props each native Text receives, so the cases below can read what a phone is told: the web
// drops those props before they reach the page.
const texts = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>();
  return {
    ...actual,
    Text: (props: ReactNative.TextProps): ReactElement => {
      texts.props.push({ ...props });
      return createElement(actual.Text, props);
    },
  };
});

const ROLES = [
  'display',
  'title',
  'heading',
  'body',
  'bodyStrong',
  'label',
  'caption',
  'captionStrong',
  'monoLabel',
  'mono',
  'numeralHero',
  'numeralDisplay',
  'numeralTitle',
  'numeralHeading',
  'initialsSm',
  'initialsMd',
  'initialsLg',
] as const;

const FURTHER_STATES = [
  'secondary',
  'inverse',
  'inverseSecondary',
  'onAccent',
  'onHighlight',
  'danger',
  'success',
  'disabled',
  'onMedia',
  'tabular',
  'headingOne',
  'twoLines',
  'fallback',
  'nested',
  'centered',
] as const;

/** The token each tone draws in. */
const TONE_TOKENS: Readonly<Record<Exclude<TextTone, 'inherit'>, ColorToken>> = {
  primary: 'text',
  secondary: 'textSecondary',
  inverse: 'inverseText',
  inverseSecondary: 'inverseTextSecondary',
  onAccent: 'onAccent',
  onHighlight: 'onHighlight',
  danger: 'danger',
  success: 'success',
  disabled: 'disabledText',
  onMedia: 'onMediaControl',
};

const PROBE = 'probe.text';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one C-Text under the probe id, in place of whatever was drawn before, and returns its element. */
function draw(props: TextProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  texts.props = [];
  renderWithProviders(<Text {...props} testID={PROBE} />, options);
  return screen.getByTestId(PROBE);
}

/** The props C-Text gave the native Text of the probe. */
function nativeProps(): Record<string, unknown> {
  const found = texts.props.find((props) => props.testID === PROBE);
  if (found === undefined) {
    throw new Error('no native Text carries the probe id');
  }
  return found;
}

describe('Text', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const [state, props] of Object.entries(STATES)) {
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state as keyof typeof STATES] ?? {}}>
            <Text {...props} testID={PROBE} />
          </InteractionPreview>,
          { theme },
        );
        expect(screen.getByTestId(PROBE).textContent, state).not.toBe('');
        view.unmount();
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold one state per role and the fifteen further states', () => {
    expect(Object.keys(STATES)).toEqual([...ROLES, ...FURTHER_STATES]);
    for (const role of ROLES) {
      expect(STATES[role].role).toBe(role);
    }
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({
      inverse: 'inverseBg',
      inverseSecondary: 'inverseBg',
      onAccent: 'accent',
      onHighlight: 'highlight',
      onMedia: 'mediaControlBg',
    });
    expect(STATES.twoLines.children).toHaveLength(120);
  });

  it('has a label and a role', () => {
    // Text takes no presses: no state draws a control, and only a heading has a role.
    for (const [state, props] of Object.entries(STATES)) {
      const view = renderWithProviders(<Text {...props} testID={PROBE} />);
      expect(view.container.querySelectorAll('a, button, [tabindex="0"]'), state).toHaveLength(0);
      const element = screen.getByTestId(PROBE);
      if (state === 'headingOne') {
        expect(screen.getByRole('heading', { name: 'Wren County clerk', level: 1 })).toBe(element);
      } else {
        expect(element.getAttribute('role'), state).toBeNull();
      }
      view.unmount();
    }
    const labelled = draw({
      role: 'body',
      accessibilityLabel: 'Closes on May 14',
      children: '5/14',
    });
    expect(labelled.getAttribute('aria-label')).toBe('Closes on May 14');
  });

  it('has a testID', () => {
    // No fixture state is interactive, so none needs an id; one that is given reaches the page.
    for (const props of Object.values(STATES)) {
      const view = renderWithProviders(<Text {...props} />);
      expect(view.container.querySelectorAll('[data-testid]')).toHaveLength(0);
      view.unmount();
    }
    const element = draw(STATES.body);
    expect(element.getAttribute('data-testid')).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
  });

  it('respects reduced motion', () => {
    for (const props of Object.values(STATES)) {
      const view = renderWithProviders(
        <InteractionPreview state={{ pressed: true }}>
          <Text {...props} testID={PROBE} />
        </InteractionPreview>,
        { reducedMotion: true },
      );
      for (const element of view.container.querySelectorAll<HTMLElement>('*')) {
        expect(element.style.transform).toBe('');
        expect(element.style.transitionProperty).toBe('');
      }
      view.unmount();
    }
  });

  it('roles draw their face, size and line height', () => {
    const title = draw(STATES.title);
    expect(title.style.fontFamily).toBe('SpecialGothic-Medium');
    expect(title.style.fontSize).toBe('28px');
    expect(title.style.lineHeight).toBe('32px');

    const body = draw(STATES.body);
    expect(body.style.fontFamily).toBe('SpecialGothic-Regular');
    expect(body.style.fontSize).toBe('16px');
    expect(body.style.lineHeight).toBe('22px');

    const monoLabel = draw(STATES.monoLabel);
    expect(monoLabel.style.fontFamily).toBe('ChivoMono-Medium');
    expect(monoLabel.style.textTransform).toBe('uppercase');
    // The capitals are a style: the words stay as they were written.
    expect(monoLabel.textContent).toBe('Cost to run');

    const numeral = draw(STATES.numeralHero);
    expect(numeral.style.fontFamily).toBe('SpecialGothic-Bold');
    expect(numeral.style.fontSize).toBe('56px');
  });

  it('no role but the fallback sets a weight', () => {
    for (const role of ROLES) {
      const element = draw(STATES[role]);
      expect(element.style.fontFamily, role).toMatch(/^(SpecialGothic|ChivoMono)-/);
      expect(element.style.fontWeight, role).toBe('');
    }
  });

  it('every tone draws its token in light and dark', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const [tone, token] of Object.entries(TONE_TOKENS)) {
        const element = draw(
          { role: 'body', tone: tone as TextTone, children: 'Sample' },
          { theme },
        );
        expect(element.style.color, `${tone} in ${theme}`).toBe(written(color[theme][token]));
      }
    }
    expect(draw(STATES.secondary).style.color).toBe(written('#535148'));
    expect(draw(STATES.secondary, { theme: 'dark' }).style.color).toBe(written('#A9A69B'));
    expect(draw(STATES.danger).style.color).toBe(written('#B3202A'));
    expect(draw(STATES.danger, { theme: 'dark' }).style.color).toBe(written('#FD8692'));
    // With no tone and no C-Text around it, text is primary.
    expect(draw(STATES.body).style.color).toBe(written('#141412'));
    expect(draw(STATES.body, { theme: 'dark' }).style.color).toBe(written('#F3F1EA'));
  });

  it('the text scale multiplies size and line height', () => {
    const body = draw(STATES.body, { textScale: 1.3 });
    expect(body.style.fontSize).toBe('20.8px');
    expect(body.style.lineHeight).toBe('28.6px');
    const title = draw(STATES.title, { textScale: 1.3 });
    expect(title.style.fontSize).toBe('36.4px');
    expect(title.style.lineHeight).toBe('41.6px');
  });

  it('a capped role stops at 130% and the others keep growing', () => {
    expect(draw(STATES.title, { textScale: 2 }).style.fontSize).toBe('36.4px');
    expect(draw(STATES.display, { textScale: 2 }).style.fontSize).toBe('52px');
    expect(draw(STATES.body, { textScale: 2 }).style.fontSize).toBe('32px');
    // On a phone the system scales the text; the same limit goes to the native Text.
    draw(STATES.title);
    expect(nativeProps().maxFontSizeMultiplier).toBe(1.3);
    draw(STATES.numeralHero);
    expect(nativeProps().maxFontSizeMultiplier).toBe(1.3);
    draw(STATES.body);
    expect(nativeProps().maxFontSizeMultiplier).toBeUndefined();
  });

  it('the tracking scales with the size', () => {
    const title = draw(STATES.title);
    expect(Number.parseFloat(title.style.letterSpacing)).toBeCloseTo(-0.42, 5);
    const scaled = draw(STATES.title, { textScale: 1.3 });
    expect(Number.parseFloat(scaled.style.letterSpacing)).toBeCloseTo(-0.546, 5);
  });

  it('a string its face cannot draw is set whole in the system font', () => {
    const fallback = draw(STATES.fallback);
    expect(fallback.style.fontFamily).not.toMatch(/SpecialGothic|ChivoMono/);
    expect(fallback.style.fontWeight).toBe('400');
    expect(fallback.style.fontSize).toBe('16px');
    expect(fallback.style.lineHeight).toBe('22px');
    expect(fallback.style.letterSpacing).toBe('');
    // It keeps its color, and scales as the role does.
    expect(fallback.style.color).toBe(written('#141412'));
    expect(draw(STATES.fallback, { textScale: 1.3 }).style.fontSize).toBe('20.8px');

    const drawable = draw({ role: 'body', children: 'Niño' });
    expect(drawable.style.fontFamily).toBe('SpecialGothic-Regular');
    expect(drawable.style.fontWeight).toBe('');

    // The weight follows the role's face, and a role that draws capitals keeps them.
    expect(draw({ role: 'title', children: 'Nguyễn Văn An' }).style.fontWeight).toBe('500');
    expect(draw({ role: 'numeralTitle', children: 'Nguyễn' }).style.fontWeight).toBe('700');
    const initials = draw({ role: 'initialsMd', children: 'Ễn' });
    expect(fontCovers('medium', 'Ễn')).toBe(false);
    expect(initials.style.fontFamily).not.toMatch(/SpecialGothic/);
    expect(initials.style.textTransform).toBe('uppercase');
  });

  it('only a single string is checked, so nothing is drawn in two faces', () => {
    // Two children are not one string: the role's face stays.
    const mixed = draw({ role: 'body', children: ['Nguyễn', ' An'] });
    expect(mixed.style.fontFamily).toBe('SpecialGothic-Regular');
  });

  it('a heading has the role and its level', () => {
    const second = draw({ role: 'heading', heading: 2, children: 'Offices near you' });
    expect(second.getAttribute('role')).toBe('heading');
    expect(second.getAttribute('aria-level')).toBe('2');
    expect(second.getAttribute('tabindex')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Offices near you' })).toBe(second);

    // A level 1 heading takes focus from code and is no Tab stop.
    const first = draw(STATES.headingOne);
    expect(first.getAttribute('aria-level')).toBe('1');
    expect(first.getAttribute('tabindex')).toBe('-1');
    first.focus();
    expect(document.activeElement).toBe(first);

    const plain = draw(STATES.title);
    expect(plain.getAttribute('aria-level')).toBeNull();
    expect(plain.getAttribute('tabindex')).toBeNull();
  });

  it('hidden text is hidden from screen readers', () => {
    const hidden = draw({ role: 'body', hidden: true, children: 'Carol Wynn' });
    expect(hidden.getAttribute('aria-hidden')).toBe('true');
    // What hides it on phones.
    expect(nativeProps().accessibilityElementsHidden).toBe(true);
    expect(nativeProps().importantForAccessibility).toBe('no-hide-descendants');

    const shown = draw(STATES.body);
    expect(shown.getAttribute('aria-hidden')).toBeNull();
    expect(nativeProps().accessibilityElementsHidden).toBeUndefined();
    expect(nativeProps().importantForAccessibility).toBeUndefined();
  });

  it('a nested C-Text inherits the tone and may change role', () => {
    renderWithProviders(
      <Text role="body" tone="danger">
        <Text role="mono" testID="probe.inner">
          dana_okafor
        </Text>
        {' filed late.'}
      </Text>,
    );
    const inner = screen.getByTestId('probe.inner');
    expect(inner.style.color).toBe(written('#B3202A'));
    expect(inner.style.fontFamily).toBe('ChivoMono-Medium');

    // A tone of its own wins over the parent's.
    cleanup();
    renderWithProviders(
      <Text role="body" tone="danger">
        <Text role="caption" tone="secondary" testID="probe.own">
          two days ago
        </Text>
      </Text>,
    );
    expect(screen.getByTestId('probe.own').style.color).toBe(written('#535148'));

    // The fixture: a handle in the mono inside a body line.
    const nested = draw(STATES.nested);
    expect(nested.style.fontFamily).toBe('SpecialGothic-Regular');
    const handle = nested.querySelector('span');
    expect(handle?.textContent).toBe('dana_okafor');
    expect(handle?.style.fontFamily).toBe('ChivoMono-Medium');
    expect(handle?.style.color).toBe(nested.style.color);
  });

  it('tabular sets fixed-width digits', () => {
    expect(draw(STATES.tabular).style.fontVariant).toBe('tabular-nums');
    expect(draw(STATES.numeralTitle).style.fontVariant).toBe('');
  });

  it('numberOfLines cuts the text and align places it', () => {
    expect(window.getComputedStyle(draw(STATES.twoLines)).webkitLineClamp).toBe('2');
    expect(nativeProps().numberOfLines).toBe(2);
    expect(draw(STATES.centered).style.textAlign).toBe('center');
    expect(draw({ role: 'body', align: 'start', children: 'Sample' }).style.textAlign).toBe('left');
    expect(draw({ role: 'body', align: 'end', children: 'Sample' }).style.textAlign).toBe('right');
    expect(draw(STATES.body).style.textAlign).toBe('');
  });

  it('text cannot be selected unless asked', () => {
    draw(STATES.body);
    expect(nativeProps().selectable).toBe(false);
    draw({ role: 'body', selectable: true, children: 'Source: the county clerk' });
    expect(nativeProps().selectable).toBe(true);
  });

  it('never turns font scaling off', () => {
    for (const props of Object.values(STATES)) {
      texts.props = [];
      const view = renderWithProviders(<Text {...props} />);
      expect(texts.props.length).toBeGreaterThan(0);
      for (const given of texts.props) {
        expect('allowFontScaling' in given).toBe(false);
      }
      expect(view.container.querySelectorAll('[allowfontscaling]')).toHaveLength(0);
      view.unmount();
    }
  });
});
