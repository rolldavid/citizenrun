import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { DealLine } from './deal-line';
import type { DealLineProps } from './deal-line';
import { GROUND, PREVIEW, STATES } from './deal-line.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';

// The props each native Text receives, so the cases below can read what a phone is told: the web
// drops the hint before it reaches the page.
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

type StateName = keyof typeof STATES;

const STATE_NAMES = ['payHours', 'payOnly', 'unknown', 'about', 'long'] as const;

const ALL: Readonly<Record<StateName, DealLineProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const HINT = 'Shows how this is worked out';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one deal, inside a preview when one is given, and gives back its paragraph. */
function draw(
  props: DealLineProps,
  options: RenderWithProvidersOptions = {},
  preview?: InteractionPreviewState,
): HTMLElement {
  cleanup();
  texts.props.length = 0;
  const element = <DealLine {...props} />;
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return screen.getByTestId(props.testID);
}

/** The parts of a state that open their figure's inputs. */
function pressableParts(props: DealLineProps): DealLineProps['parts'] {
  return props.parts.filter((part) => part.onPress !== undefined);
}

/** Every stretch of the paragraph that carries an underline. */
function underlinedIn(paragraph: HTMLElement): HTMLElement[] {
  return [...paragraph.querySelectorAll<HTMLElement>('*')].filter((part) =>
    part.style.textDecorationLine.includes('underline'),
  );
}

describe('DealLine', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const paragraph = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // One paragraph in the title role, in the text color.
          expect(paragraph.textContent, name).toBe(props.parts.map((part) => part.text).join(' '));
          expect(paragraph.style.fontFamily, name).toContain(
            String(typography.title.style.fontFamily),
          );
          expect(paragraph.style.color, name).toBe(written(color[theme].text));
          // Never bold inside the sentence, never a color: every stretch is the paragraph's own.
          for (const part of paragraph.querySelectorAll<HTMLElement>('*')) {
            if (part.style.fontFamily !== '') {
              expect(part.style.fontFamily, name).toBe(paragraph.style.fontFamily);
            }
            if (part.style.color !== '') {
              expect(part.style.color, name).toBe(paragraph.style.color);
            }
            expect(part.style.fontWeight, name).toBe('');
          }
          for (const underlined of underlinedIn(paragraph)) {
            expect(underlined.style.textDecorationStyle, name).toBe('solid');
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the five states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.deal-line-${kebab(state)}`);
    }
    expect(STATES.payHours.parts.map((part) => part.text)).toEqual([
      'Pays $52,900 a year.',
      'About 20 hours a week.',
    ]);
    expect(STATES.payHours.parts.map((part) => part.figure)).toEqual(['$52,900', '20 hours']);
    expect(STATES.unknown.parts.map((part) => part.text)).toEqual([
      'Pay not known yet.',
      'Hours not known yet.',
    ]);
    expect(STATES.about.parts[0].text).toBe('Pays about $52,900 a year.');
    expect(STATES.long.parts).toHaveLength(4);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const paragraph = draw(props);
      // The paragraph is read as text; only a part that opens something is a control.
      expect(paragraph.getAttribute('role'), state).toBeNull();
      expect(paragraph.getAttribute('aria-label'), state).toBeNull();
      const buttons = within(paragraph).queryAllByRole('button');
      expect(
        buttons.map((button) => button.textContent),
        state,
      ).toEqual(pressableParts(props).map((part) => part.text));
      for (const button of buttons) {
        // The name is the sentence itself, so nothing overrides it.
        expect(button.getAttribute('aria-label'), state).toBeNull();
        expect(button.getAttribute('tabindex'), state).toBe('0');
        // Text in the line, not a box of its own: the sentence wraps with its paragraph.
        expect(button.tagName, state).not.toBe('BUTTON');
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const paragraph = draw(props);
      expect(paragraph.getAttribute('data-testid'), state).toMatch(TEST_ID);
      const ids = [...document.querySelectorAll('[data-testid]')].map((part) =>
        part.getAttribute('data-testid'),
      );
      // The paragraph's id, then one for each part that opens something.
      expect(ids, state).toEqual([
        props.testID,
        ...pressableParts(props).map((part) => `${props.testID}-${part.id}`),
      ]);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    // A part cuts to its heavier underline and its ring and never moves, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const paragraph = draw(ALL[state], { reducedMotion }, { hovered: true, focused: true });
        for (const part of [paragraph, ...paragraph.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      const paragraph = draw(STATES.unknown, { theme });
      // The sentences say it, at full contrast: never grey, never a dash, never a blank.
      expect(paragraph.textContent, theme).toBe('Pay not known yet. Hours not known yet.');
      expect(paragraph.style.color, theme).toBe(written(color[theme].text));
      for (const part of paragraph.querySelectorAll<HTMLElement>('*')) {
        expect(part.style.opacity, theme).toBe('');
        if (part.style.color !== '') {
          expect(part.style.color, theme).toBe(written(color[theme].text));
        }
      }
    }
  });

  it('parts joined by the separator', () => {
    expect(draw(STATES.payHours).textContent).toBe('Pays $52,900 a year. About 20 hours a week.');
    expect(draw(STATES.payOnly).textContent).toBe('Pays $52,900 a year.');
    expect(draw(STATES.long).textContent).toBe(
      'Pays $52,941 a year plus benefits. About 20 hours a week. High impact on Rent and housing costs. About 2,100 votes win it.',
    );
  });

  it('a pressable part', () => {
    const pay = vi.fn();
    const hours = vi.fn();
    const paragraph = draw({
      parts: [
        { id: 'pay', text: 'Pays $52,900 a year.', figure: '$52,900', onPress: pay },
        { id: 'hours', text: 'About 20 hours a week.', figure: '20 hours', onPress: hours },
      ],
      testID: 'fixture.deal',
    });
    // A phone is told what pressing does; the web drops the hint.
    const hinted = texts.props.filter((props) => props.accessibilityHint !== undefined);
    expect(hinted.map((props) => props.testID)).toEqual(['fixture.deal-pay', 'fixture.deal-hours']);
    for (const props of hinted) {
      expect(props.accessibilityHint).toBe(HINT);
    }

    // Two buttons, each named by its own sentence: the name is the words, with no label over them.
    const [payPart, hoursPart] = within(paragraph).getAllByRole('button') as [
      HTMLElement,
      HTMLElement,
    ];
    expect(within(paragraph).getAllByRole('button')).toHaveLength(2);
    expect(payPart.textContent).toBe('Pays $52,900 a year.');
    expect(hoursPart.textContent).toBe('About 20 hours a week.');
    expect(payPart.getAttribute('aria-label')).toBeNull();
    expect(hoursPart.getAttribute('aria-label')).toBeNull();
    expect(payPart.getAttribute('data-testid')).toBe('fixture.deal-pay');
    expect(hoursPart.getAttribute('data-testid')).toBe('fixture.deal-hours');

    fireEvent.click(payPart);
    expect(pay).toHaveBeenCalledTimes(1);
    expect(hours).not.toHaveBeenCalled();
    fireEvent.click(hoursPart);
    expect(pay).toHaveBeenCalledTimes(1);
    expect(hours).toHaveBeenCalledTimes(1);

    // Enter and Space press it from the keyboard, once for a held key; other keys do nothing.
    fireEvent.keyDown(payPart, { key: 'Enter' });
    expect(pay).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(payPart, { key: ' ' });
    expect(pay).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(payPart, { key: 'Enter', repeat: true });
    fireEvent.keyDown(payPart, { key: 'a' });
    fireEvent.keyDown(payPart, { key: 'Tab' });
    expect(pay).toHaveBeenCalledTimes(3);
    expect(hours).toHaveBeenCalledTimes(1);

    // Keyboard focus draws the ring on the part, and leaving takes it away.
    expect(payPart.style.outlineStyle).toBe('');
    fireEvent.focus(payPart);
    expect(payPart.style.outlineStyle).toBe('solid');
    expect(payPart.style.outlineColor).toBe(written(color.light.focusRing));
    expect(hoursPart.style.outlineStyle).toBe('');
    fireEvent.blur(payPart);
    expect(payPart.style.outlineStyle).toBe('');
  });

  it('the figure is underlined once', () => {
    for (const theme of ['light', 'dark'] as const) {
      const paragraph = draw(
        {
          parts: [
            {
              id: 'pay',
              text: 'Pays $52,900 a year, and $52,900 in a second term.',
              figure: '$52,900',
              onPress: () => undefined,
            },
          ],
          testID: 'fixture.deal',
        },
        { theme },
      );
      // Only the first occurrence carries the underline, solid, in the text color.
      const underlined = underlinedIn(paragraph);
      expect(underlined, theme).toHaveLength(1);
      const [figure] = underlined;
      expect(figure?.textContent, theme).toBe('$52,900');
      expect(figure?.style.textDecorationStyle, theme).toBe('solid');
      expect(figure?.style.textDecorationColor, theme).toBe(written(color[theme].text));
      expect(paragraph.textContent, theme).toBe(
        'Pays $52,900 a year, and $52,900 in a second term.',
      );
      const part = screen.getByTestId('fixture.deal-pay');
      const before = part.textContent.slice(0, part.textContent.indexOf('$52,900'));
      expect(before, theme).toBe('Pays ');
      expect(
        figure?.previousElementSibling?.textContent ?? figure?.previousSibling?.textContent,
        theme,
      ).toBe('Pays ');
    }

    // Each part underlines its own figure.
    expect(underlinedIn(draw(STATES.payHours)).map((part) => part.textContent)).toEqual([
      '$52,900',
      '20 hours',
    ]);
    expect(underlinedIn(draw(STATES.long)).map((part) => part.textContent)).toEqual([
      '$52,941',
      '20 hours',
      '2,100 votes',
    ]);

    // A part with no figure, or one its sentence does not hold, is still a target and has no underline.
    for (const figure of [undefined, '$99']) {
      const onPress = vi.fn();
      const paragraph = draw({
        parts: [
          {
            id: 'pay',
            text: 'Pays $52,900 a year.',
            onPress,
            ...(figure === undefined ? {} : { figure }),
          },
        ],
        testID: 'fixture.deal',
      });
      expect(underlinedIn(paragraph), String(figure)).toHaveLength(0);
      const part = within(paragraph).getByRole('button');
      expect(part.textContent, String(figure)).toBe('Pays $52,900 a year.');
      fireEvent.click(part);
      expect(onPress, String(figure)).toHaveBeenCalledTimes(1);
    }
  });

  it('an unknown part is plain', () => {
    const paragraph = draw(STATES.unknown);
    expect(within(paragraph).queryAllByRole('button')).toHaveLength(0);
    expect(paragraph.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(underlinedIn(paragraph)).toHaveLength(0);
    expect(texts.props.filter((props) => props.accessibilityHint !== undefined)).toHaveLength(0);
    // A figure on a part that opens nothing is not underlined: an underline promises a target.
    const plain = draw({
      parts: [{ id: 'pay', text: 'Pays $52,900 a year.', figure: '$52,900' }],
      testID: 'fixture.deal',
    });
    expect(underlinedIn(plain)).toHaveLength(0);
    expect(within(plain).queryAllByRole('button')).toHaveLength(0);
  });
});
