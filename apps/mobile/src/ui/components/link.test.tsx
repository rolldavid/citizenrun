import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { Link } from './link';
import type { LinkProps } from './link';
import { GROUND, PREVIEW, STATES } from './link.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'inline',
  'inlineHovered',
  'inlineFocused',
  'bare',
  'external',
  'refusedHttp',
  'refusedProtocolRelative',
] as const;

/** The states whose address the link accepts. */
const ACCEPTED = ['inline', 'inlineHovered', 'inlineFocused', 'bare', 'external'] as const;
const REFUSED = ['refusedHttp', 'refusedProtocolRelative'] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.link';

const words = <Text role="body">Filing rules</Text>;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function show(
  element: ReactElement,
  preview: InteractionPreviewState | undefined,
  options: RenderWithProvidersOptions,
): void {
  cleanup();
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): HTMLElement {
  show(<Link {...STATES[state]} />, preview, options);
  return screen.getByTestId(STATES[state].testID);
}

type ProbeProps = Partial<LinkProps> & { preview?: InteractionPreviewState };

/** Renders one C-Link under the probe id, to an in-app path unless told otherwise. */
function draw(given: ProbeProps = {}, options: RenderWithProvidersOptions = {}): HTMLElement {
  const { preview, children, ...props } = given;
  show(
    <Link href="/office/fixture-office" testID={PROBE} {...props}>
      {children ?? words}
    </Link>,
    preview,
    options,
  );
  return screen.getByTestId(PROBE);
}

const SENTENCE = 'probe.sentence';
const linkedWords = (
  <Text role="caption" tone="primary">
    Terms
  </Text>
);

/** Renders one C-Link inside a sentence, as a consent line holds one, to an outside address. */
function drawInSentence(
  given: ProbeProps = {},
  options: RenderWithProvidersOptions = {},
): { sentence: HTMLElement; link: HTMLElement } {
  const { preview, children, ...props } = given;
  show(
    <Text role="caption" tone="secondary" testID={SENTENCE}>
      By going on you accept the{' '}
      <Link href="https://www.example.test/terms" external={true} testID={PROBE} {...props}>
        {children ?? linkedWords}
      </Link>
      .
    </Text>,
    preview,
    options,
  );
  return { sentence: screen.getByTestId(SENTENCE), link: screen.getByTestId(PROBE) };
}

/** The view that carries the underline: the anchor's one child. */
function underlineOf(anchor: HTMLElement): HTMLElement {
  const child = anchor.firstElementChild;
  if (!(child instanceof HTMLElement) || anchor.childElementCount !== 1) {
    throw new Error('the link does not hold exactly one view');
  }
  return child;
}

/** Asserts that nothing on the page can be followed, and that the words are still drawn. */
function expectRefused(element: HTMLElement, what: string): void {
  expect(element.tagName, what).toBe('DIV');
  expect(document.querySelectorAll('a'), what).toHaveLength(0);
  expect(document.querySelectorAll('[href]'), what).toHaveLength(0);
  expect(document.querySelectorAll('[role="link"]'), what).toHaveLength(0);
  expect(screen.queryByRole('link'), what).toBeNull();
  expect(document.querySelectorAll('[tabindex]'), what).toHaveLength(0);
  expect(element.textContent, what).toBe('Filing rules');
}

describe('Link', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        expect(drawState(state, { theme }).textContent, state).toBe('Filing rules');
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(STATES[state].label, state).toBe('Filing rules');
    }
    expect(STATES.external).toMatchObject({
      href: 'https://www.example.test/filing',
      external: true,
    });
    expect(STATES.refusedHttp).toMatchObject({ href: 'http://example.test', external: true });
    expect(STATES.refusedProtocolRelative.href).toBe('//example.test/x');
    expect(PREVIEW).toEqual({ inlineHovered: { hovered: true }, inlineFocused: { focused: true } });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of ACCEPTED) {
      const element = drawState(state);
      const name =
        state === 'external' ? 'Filing rules, opens in your browser' : STATES[state].label;
      expect(screen.getByRole('link', { name }), state).toBe(element);
      expect(element.getAttribute('aria-label'), state).toBe(name);
    }
    // A refused address draws no link: nothing on the page takes a press.
    for (const state of REFUSED) {
      expectRefused(drawState(state), state);
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const element = drawState(state);
      expect(element.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(element.getAttribute('data-testid'), state).toBe(`gallery.link-${kebab(state)}`);
    }
  });

  it('respects reduced motion', () => {
    // A link never moves on press, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const element = drawState(state, { reducedMotion }, { pressed: true });
        for (const part of [element, ...element.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
        }
      }
    }
  });

  it('an in-app path renders an anchor with that address', () => {
    const anchor = draw({ href: '/office/fixture-office' });
    expect(anchor.tagName).toBe('A');
    expect(anchor.getAttribute('href')).toBe('/office/fixture-office');
    expect(anchor.getAttribute('role')).toBe('link');
    expect(anchor.getAttribute('target')).toBeNull();
    expect(anchor.getAttribute('rel')).toBeNull();
    expect(draw({ href: '/' }).getAttribute('href')).toBe('/');
    expect(draw({ href: '/dev/gallery?theme=dark#button' }).getAttribute('href')).toBe(
      '/dev/gallery?theme=dark#button',
    );
  });

  it('refuses an address that is not an in-app path', () => {
    const refused = [
      '//example.test/x',
      '/\\example.test',
      'http://example.test',
      'https://www.example.test/a',
      'javascript:alert(1)',
      'example.test',
      'office/fixture-office',
      '',
    ];
    for (const href of refused) {
      expectRefused(draw({ href }), href);
    }
  });

  it('a refused link keeps its id and opens nothing', () => {
    const element = draw({ href: 'javascript:alert(1)' });
    expect(element.getAttribute('data-testid')).toBe(PROBE);
    expect(element.getAttribute('aria-label')).toBeNull();
    expect(element.style.cursor).toBe('');
    // No underline promises a link that is not there.
    expect(element.querySelectorAll('[style*="border-bottom"]')).toHaveLength(0);
    fireEvent.click(element);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('an outside https link opens in a new tab and says so', () => {
    const anchor = draw({
      href: 'https://www.example.test/a',
      external: true,
      label: 'Filing rules',
    });
    expect(anchor.tagName).toBe('A');
    expect(anchor.getAttribute('href')).toBe('https://www.example.test/a');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(screen.getByRole('link', { name: 'Filing rules, opens in your browser' })).toBe(anchor);
  });

  it('refuses an outside address that is not a safe https URL', () => {
    const refused = [
      'http://example.test',
      '//example.test/x',
      '/office/fixture-office',
      'javascript:alert(1)',
      'example.test',
      'https://user@example.test/a',
      'https://example.test/a b',
      `https://www.example.test/${'a'.repeat(2049 - 'https://www.example.test/'.length)}`,
    ];
    expect(refused.at(-1)).toHaveLength(2049);
    for (const href of refused) {
      expectRefused(draw({ href, external: true }), href.slice(0, 40));
    }
    // The longest address it takes is 2,048 characters.
    const longest = `https://www.example.test/${'a'.repeat(2048 - 'https://www.example.test/'.length)}`;
    expect(longest).toHaveLength(2048);
    expect(draw({ href: longest, external: true }).getAttribute('href')).toBe(longest);
  });

  it('opens the address the check accepted', () => {
    const anchor = draw({ href: '  https://WWW.Example.TEST/Filing  ', external: true });
    expect(anchor.getAttribute('href')).toBe('https://www.example.test/Filing');
  });

  it('the inline underline is one point at rest and two under a pointer or the keyboard', () => {
    const rest = underlineOf(drawState('inline'));
    expect(rest.style.borderBottomWidth).toBe('1px');
    // The room the thicker line will take is held, so nothing moves when it thickens.
    expect(rest.style.marginBottom).toBe('1px');
    expect(rest.style.alignSelf).toBe('flex-start');

    for (const state of ['inlineHovered', 'inlineFocused'] as const) {
      const thick = underlineOf(drawState(state));
      expect(thick.style.borderBottomWidth, state).toBe('2px');
      expect(thick.style.marginBottom, state).toBe('0px');
    }

    // Real focus thickens it too, and it thins again when focus leaves.
    const anchor = drawState('inline');
    act(() => {
      anchor.focus();
    });
    expect(underlineOf(anchor).style.borderBottomWidth).toBe('2px');
    act(() => {
      anchor.blur();
    });
    expect(underlineOf(anchor).style.borderBottomWidth).toBe('1px');
  });

  it('the underline is linkText and never another color', () => {
    for (const state of ['inline', 'inlineHovered', 'inlineFocused', 'external'] as const) {
      expect(underlineOf(drawState(state)).style.borderBottomColor, state).toBe(written('#141412'));
      expect(underlineOf(drawState(state, { theme: 'dark' })).style.borderBottomColor, state).toBe(
        written('#F3F1EA'),
      );
    }
  });

  it('an underlined link is as wide as its words, and a bare one as wide as its container', () => {
    for (const state of ['inline', 'inlineHovered', 'inlineFocused', 'external'] as const) {
      // The view round the anchor keeps it, its press target and its focus ring to the words.
      expect(drawState(state).parentElement?.style.alignItems, state).toBe('flex-start');
    }
    expect(drawState('bare').parentElement?.style.alignItems).toBe('');
  });

  it('a bare link has no underline', () => {
    const anchor = drawState('bare');
    expect(anchor.tagName).toBe('A');
    expect(anchor.querySelectorAll('[style*="border-bottom"]')).toHaveLength(0);
    const hovered = drawState('bare', {}, { hovered: true, focused: true });
    expect(hovered.querySelectorAll('[style*="border-bottom"]')).toHaveLength(0);
  });

  it('takes no fill and a square focus ring', () => {
    const anchor = drawState('inline', {}, { hovered: true, pressed: true, focused: true });
    expect(anchor.style.backgroundColor).toBe('');
    expect(anchor.style.borderRadius).toBe('0px');
    expect(anchor.style.outlineStyle).toBe('solid');
    expect(anchor.style.outlineWidth).toBe('2px');
  });

  it('inside a line of text the link is text in that line and holds no box', () => {
    const { sentence, link } = drawInSentence();
    expect(link.tagName).toBe('A');
    // Nothing stands between the sentence and its link, and no view is set into the line: a phone
    // would lay a view there as a block, off the baseline of the words beside it.
    expect(link.parentElement).toBe(sentence);
    expect(sentence.querySelectorAll('div')).toHaveLength(0);
    expect(sentence.querySelectorAll('[style*="border-bottom"]')).toHaveLength(0);
    expect(sentence.querySelectorAll('[style*="flex"]')).toHaveLength(0);
    expect(link.style.textDecorationLine).toBe('underline');
    expect(sentence.textContent).toBe('By going on you accept the Terms.');
    // The same link through an in-app path.
    const inApp = drawInSentence({ href: '/office/fixture-office', external: false });
    expect(inApp.link.tagName).toBe('A');
    expect(inApp.link.getAttribute('href')).toBe('/office/fixture-office');
    expect(inApp.link.getAttribute('target')).toBeNull();
    expect(inApp.sentence.querySelectorAll('div')).toHaveLength(0);
  });

  it('the underline in a line of text is one point, and two under a pointer or the keyboard', () => {
    const { link } = drawInSentence();
    expect(link.style.textDecorationThickness).toBe('1px');
    expect(link.style.textUnderlineOffset).toBe('0.18em');
    // A space the line breaks at inside the link is not underlined.
    expect(link.style.whiteSpace).toBe('normal');
    expect(link.style.textDecorationColor).toBe(written('#141412'));
    expect(drawInSentence({}, { theme: 'dark' }).link.style.textDecorationColor).toBe(
      written('#F3F1EA'),
    );

    const hovered = drawInSentence().link;
    fireEvent.mouseEnter(hovered);
    expect(hovered.style.textDecorationThickness).toBe('2px');
    fireEvent.mouseLeave(hovered);
    expect(hovered.style.textDecorationThickness).toBe('1px');

    // Focus thickens it and draws the square ring; both go when focus leaves.
    const focused = drawInSentence().link;
    act(() => {
      focused.focus();
    });
    expect(focused.style.textDecorationThickness).toBe('2px');
    expect(focused.style.outlineStyle).toBe('solid');
    expect(focused.style.outlineWidth).toBe('2px');
    expect(focused.style.borderRadius).toBe('0px');
    act(() => {
      focused.blur();
    });
    expect(focused.style.textDecorationThickness).toBe('1px');
    expect(focused.style.outlineStyle).toBe('');

    // The gallery's forced states reach it as they reach the boxed link.
    for (const preview of [{ hovered: true }, { focused: true }]) {
      expect(drawInSentence({ preview }).link.style.textDecorationThickness).toBe('2px');
    }
  });

  it('an outside link in a line of text opens in a new tab and says so', () => {
    const { link } = drawInSentence({ label: 'Terms' });
    expect(link.getAttribute('href')).toBe('https://www.example.test/terms');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(screen.getByRole('link', { name: 'Terms, opens in your browser' })).toBe(link);
    // With no name of its own it is named by the words inside it.
    const unnamed = drawInSentence({ href: '/office/fixture-office', external: false }).link;
    expect(unnamed.hasAttribute('aria-label')).toBe(false);
    expect(screen.getByRole('link', { name: 'Terms' })).toBe(unnamed);
  });

  it('plain words in a line of text take the type of that line', () => {
    const { sentence, link } = drawInSentence({ children: 'Terms' });
    expect(link.childElementCount).toBe(0);
    expect(link.textContent).toBe('Terms');
    expect(link.style.fontSize).toBe('');
    expect(link.getAttribute('aria-label')).toBe('Terms, opens in your browser');
    expect(sentence.textContent).toBe('By going on you accept the Terms.');
  });

  it('a refused address in a line of text draws its words there and opens nothing', () => {
    for (const href of ['http://example.test', 'javascript:alert(1)', '/office/fixture-office']) {
      const { sentence, link } = drawInSentence({ href });
      expect(link.tagName, href).toBe('SPAN');
      expect(link.parentElement, href).toBe(sentence);
      expect(link.style.textDecorationLine, href).toBe('');
      expect(document.querySelectorAll('a'), href).toHaveLength(0);
      expect(document.querySelectorAll('[href]'), href).toHaveLength(0);
      expect(screen.queryByRole('link'), href).toBeNull();
      expect(sentence.querySelectorAll('div'), href).toHaveLength(0);
      expect(sentence.textContent, href).toBe('By going on you accept the Terms.');
    }
  });

  it('is named by its label, or by its words', () => {
    expect(draw({ label: 'Filing rules for Wren County' }).getAttribute('aria-label')).toBe(
      'Filing rules for Wren County',
    );
    // Words given as a string are the name, and are drawn as body text.
    const plain = draw({ children: 'Filing rules' });
    expect(plain.getAttribute('aria-label')).toBe('Filing rules');
    expect(screen.getByText('Filing rules').style.fontFamily).toBe('SpecialGothic-Regular');
    expect(screen.getByText('Filing rules').style.fontSize).toBe('16px');
    const outside = draw({
      href: 'https://www.example.test/a',
      external: true,
      children: 'Filing rules',
    });
    expect(outside.getAttribute('aria-label')).toBe('Filing rules, opens in your browser');
    // With neither, the anchor takes its name from the text inside it.
    const unnamed = draw({});
    expect(unnamed.hasAttribute('aria-label')).toBe(false);
    expect(screen.getByRole('link', { name: 'Filing rules' })).toBe(unnamed);
  });
});
