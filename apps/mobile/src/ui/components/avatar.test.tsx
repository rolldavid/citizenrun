import { fontCovers } from '@citizenrun/shared';
import { cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { Avatar, avatarInitials } from './avatar';
import type { AvatarProps } from './avatar';
import { GROUND, PREVIEW, STATES } from './avatar.fixtures';
import { InteractionPreview } from './pressable';

// The props each View receives, so the cases below can read what a phone's screen reader is told:
// the web drops those props before they reach the page.
const views = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

// The props each native Text receives: a phone scales its text itself, within the limit it is given.
const texts = vi.hoisted(() => {
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
    Text: (props: ReactNative.TextProps): ReactElement => {
      texts.props.push({ ...props });
      return createElement(actual.Text, props);
    },
  };
});

const STATE_NAMES = [
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  'oneWord',
  'handleOnly',
  'empty',
  'withImagePending',
  'decorative',
  'notDrawable',
] as const;

const PROBE = 'probe.avatar';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one avatar under the probe id, in place of whatever was drawn before. */
function draw(props: AvatarProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  views.props = [];
  texts.props = [];
  renderWithProviders(<Avatar {...props} testID={PROBE} />, options);
  return screen.getByTestId(PROBE);
}

/** The props C-Avatar gave its disc. */
function discProps(): Record<string, unknown> {
  const found = views.props.find((props) => props.testID === PROBE);
  if (found === undefined) {
    throw new Error('no view carries the probe id');
  }
  return found;
}

/** The initials inside a disc; null when it draws none. */
function initialsOf(disc: HTMLElement): HTMLElement | null {
  const child = disc.firstElementChild;
  return child instanceof HTMLElement ? child : null;
}

/** A length the page wrote in points, as a number. */
function points(length: string | undefined): number {
  return Number.parseFloat(length ?? '');
}

/** The largest text scale C-Avatar let the native Text of its initials take. */
function initialsLimit(): number {
  const limit = texts.props.at(-1)?.maxFontSizeMultiplier;
  if (typeof limit !== 'number') {
    throw new Error('the initials carry no limit');
  }
  return limit;
}

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

describe('Avatar', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <Avatar {...STATES[state]} testID={PROBE} />
          </InteractionPreview>,
          { theme },
        );
        expect(screen.getByTestId(PROBE).style.borderRadius, state).toBe('9999px');
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the eleven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      expect(STATES[size]).toEqual({ size, image: null, name: 'Carol Wynn', handle: 'carol_wynn' });
    }
    expect(STATES.oneWord.name).toBe('Alder');
    expect(STATES.handleOnly).toMatchObject({ name: null, handle: 'dana_okafor' });
    expect(STATES.empty).toMatchObject({ name: null, handle: null });
    expect(STATES.withImagePending.image).toEqual({
      key: 'fixture-avatar',
      url: 'https://media.example.test/fixture-avatar.jpg',
    });
    expect(STATES.decorative.decorative).toBe(true);
    expect(STATES.notDrawable.name).toBe('Nguyễn An');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    // An avatar takes no presses. It is an image with the person's name, or it is hidden.
    for (const state of STATE_NAMES) {
      const disc = draw(STATES[state]);
      expect(document.querySelectorAll('a, button, [tabindex]'), state).toHaveLength(0);
      if (state === 'decorative' || state === 'empty') {
        expect(disc.getAttribute('aria-hidden'), state).toBe('true');
        expect(disc.getAttribute('role'), state).toBeNull();
        expect(disc.getAttribute('aria-label'), state).toBeNull();
        expect(screen.queryByRole('img'), state).toBeNull();
      } else {
        expect(disc.getAttribute('role'), state).toBe('img');
        expect(disc.getAttribute('aria-label'), state).toMatch(/^Photo of \S/);
        expect(screen.getByRole('img'), state).toBe(disc);
      }
    }
  });

  it('has a testID', () => {
    // No state is interactive, so none needs an id; one that is given reaches the disc.
    for (const state of STATE_NAMES) {
      cleanup();
      const view = renderWithProviders(<Avatar {...STATES[state]} />);
      expect(view.container.querySelectorAll('[data-testid]'), state).toHaveLength(0);
    }
    expect(draw(STATES.md).getAttribute('data-testid')).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      cleanup();
      const view = renderWithProviders(
        <InteractionPreview state={{ pressed: true }}>
          <Avatar {...STATES[state]} />
        </InteractionPreview>,
        { reducedMotion: true },
      );
      for (const element of view.container.querySelectorAll<HTMLElement>('*')) {
        expect(element.style.transform, state).toBe('');
        expect(element.style.transitionProperty, state).toBe('');
      }
    }
  });

  it('avatarInitials takes the first letters of the first and last words', () => {
    expect(avatarInitials('Carol Wynn', 'carol_wynn')).toBe('CW');
    expect(avatarInitials('Alder', null)).toBe('A');
    expect(avatarInitials('Mary Ann de la Cruz', null)).toBe('MC');
    expect(avatarInitials('  Dana \t Okafor  ', null)).toBe('DO');
    // The role draws the capitals: the letters come back as they were written.
    expect(avatarInitials('carol wynn', null)).toBe('cw');
  });

  it('avatarInitials falls to the handle, and then to nothing', () => {
    expect(avatarInitials(null, 'dana_okafor')).toBe('d');
    expect(avatarInitials('  ', 'x')).toBe('x');
    expect(avatarInitials('', 'carol_wynn')).toBe('c');
    expect(avatarInitials(null, null)).toBe('');
    expect(avatarInitials('', '')).toBe('');
    expect(avatarInitials(' ', null)).toBe('');
  });

  it('avatarInitials counts characters, not code units', () => {
    // An emoji takes two code units: the whole of it is kept, never half.
    expect(avatarInitials('😀 Wynn', null)).toBe('😀W');
    expect(avatarInitials('Carol 😀', null)).toBe('C😀');
    expect(avatarInitials(null, '😀dana')).toBe('😀');
  });

  it('the five sizes are 28, 36, 48, 56 and 80 points, and round', () => {
    const sides = { xs: '28px', sm: '36px', md: '48px', lg: '56px', xl: '80px' } as const;
    for (const [size, side] of Object.entries(sides)) {
      const disc = draw(STATES[size as keyof typeof sides]);
      expect(disc.style.width, size).toBe(side);
      expect(disc.style.height, size).toBe(side);
      expect(disc.style.borderRadius, size).toBe('9999px');
    }
  });

  it('is a flat well disc with nothing round it', () => {
    const disc = draw(STATES.md);
    expect(disc.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(disc.style.borderWidth).toBe('');
    expect(disc.style.outlineStyle).toBe('');
    expect(disc.childElementCount).toBe(1);
    expect(draw(STATES.md, { theme: 'dark' }).style.backgroundColor).toBe(written('#2A2A26'));
  });

  it('the initials use the role of the size, in capitals, in text', () => {
    const sizes = { xs: '14px', sm: '14px', md: '20px', lg: '20px', xl: '28px' } as const;
    for (const [size, fontSize] of Object.entries(sizes)) {
      const initials = initialsOf(draw(STATES[size as keyof typeof sizes]));
      expect(initials?.textContent, size).toBe('CW');
      expect(initials?.style.fontSize, size).toBe(fontSize);
      expect(initials?.style.fontFamily, size).toBe('SpecialGothic-Medium');
      expect(initials?.style.textTransform, size).toBe('uppercase');
      expect(initials?.style.color, size).toBe(written('#141412'));
    }
    expect(initialsOf(draw(STATES.md, { theme: 'dark' }))?.style.color).toBe(written('#F3F1EA'));
  });

  it('the initials grow with the text size, and stop at half their disc', () => {
    const sides = { xs: 28, sm: 36, md: 48, lg: 56, xl: 80 } as const;
    // At 130% the smallest disc has no room to give; the two largest still have.
    const at130 = { xs: 14, sm: 18, md: 24, lg: 26, xl: 36.4 } as const;
    // However large the text, the letters stay inside the disc.
    const atMost = { xs: 14, sm: 18, md: 24, lg: 28, xl: 40 } as const;
    for (const size of SIZES) {
      const grown = initialsOf(draw(STATES[size], { textScale: 1.3 }));
      expect(points(grown?.style.fontSize), size).toBeCloseTo(at130[size], 5);
      for (const textScale of [2, 3.1]) {
        const largest = initialsOf(draw(STATES[size], { textScale }));
        expect(points(largest?.style.fontSize), size).toBeCloseTo(atMost[size], 5);
        expect(points(largest?.style.fontSize), size).toBeLessThanOrEqual(sides[size] / 2 + 1e-9);
      }
      // The disc itself never grows.
      expect(points(draw(STATES[size], { textScale: 1.3 }).style.width), size).toBe(sides[size]);
    }
    // The line stops with the letters: 14 on 18 in the smallest disc, 18 on 23.14 in the next.
    const smallest = initialsOf(draw(STATES.xs, { textScale: 1.3 }));
    expect(points(smallest?.style.lineHeight)).toBeCloseTo(18, 5);
    const next = initialsOf(draw(STATES.sm, { textScale: 1.3 }));
    expect(points(next?.style.lineHeight)).toBeCloseTo(23.143, 2);
  });

  it('on a phone the system text size meets the same limit', () => {
    // The limit times the size of the role is half the disc: 14, 18, 24, 28 and 40 points.
    const roleSizes = { xs: 14, sm: 14, md: 20, lg: 20, xl: 28 } as const;
    const atMost = { xs: 14, sm: 18, md: 24, lg: 28, xl: 40 } as const;
    for (const size of SIZES) {
      draw(STATES[size]);
      expect(initialsLimit() * roleSizes[size], size).toBeCloseTo(atMost[size], 5);
      // A limit under 1 would turn the limit off on a phone.
      expect(initialsLimit(), size).toBeGreaterThanOrEqual(1);
    }
    draw(STATES.xs);
    expect(initialsLimit()).toBe(1);
    // Initials the face cannot draw are held the same way.
    draw({ size: 'xs', image: null, name: 'Ễn Ước', handle: null });
    expect(initialsLimit()).toBe(1);
  });

  it('one word gives one letter, a handle its first character, and nobody an empty disc', () => {
    expect(initialsOf(draw(STATES.oneWord))?.textContent).toBe('A');
    const handle = initialsOf(draw(STATES.handleOnly));
    expect(handle?.textContent).toBe('d');
    expect(handle?.style.textTransform).toBe('uppercase');
    expect(draw(STATES.empty).childElementCount).toBe(0);
  });

  it('a photo keeps the bare disc as its placeholder', () => {
    const disc = draw(STATES.withImagePending);
    expect(disc.childElementCount).toBe(0);
    expect(disc.textContent).toBe('');
    expect(disc.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(document.querySelectorAll('img')).toHaveLength(0);
    // It is still that person's picture.
    expect(disc.getAttribute('aria-label')).toBe('Photo of Carol Wynn');
  });

  it('is named after the person, by name before handle', () => {
    const named = draw(STATES.md);
    expect(screen.getByRole('img', { name: 'Photo of Carol Wynn' })).toBe(named);
    expect(named.getAttribute('aria-label')).toBe('Photo of Carol Wynn');
    expect(draw(STATES.handleOnly).getAttribute('aria-label')).toBe('Photo of dana_okafor');
    expect(draw(STATES.oneWord).getAttribute('aria-label')).toBe('Photo of Alder');
    // A name of spaces is no name.
    const blank = draw({ size: 'md', image: null, name: '  ', handle: 'dana_okafor' });
    expect(blank.getAttribute('aria-label')).toBe('Photo of dana_okafor');
    // On a phone the disc is one element for the screen reader.
    draw(STATES.md);
    expect(discProps().accessible).toBe(true);
    expect(discProps().accessibilityElementsHidden).toBeUndefined();
  });

  it('decorative and empty avatars are hidden from screen readers', () => {
    for (const state of ['decorative', 'empty'] as const) {
      const disc = draw(STATES[state]);
      expect(disc.getAttribute('aria-hidden'), state).toBe('true');
      // What hides it on phones.
      expect(discProps().accessibilityElementsHidden, state).toBe(true);
      expect(discProps().importantForAccessibility, state).toBe('no-hide-descendants');
      expect(discProps().accessible, state).toBeUndefined();
    }
    // Nobody to name, whatever the photo.
    const nameless = draw({ ...STATES.withImagePending, name: null, handle: null });
    expect(nameless.getAttribute('aria-hidden')).toBe('true');
  });

  it('initials the face cannot draw are set in the system font', () => {
    // The fixture's own initials are plain letters, which the face draws.
    const drawable = initialsOf(draw(STATES.notDrawable));
    expect(drawable?.textContent).toBe('NA');
    expect(fontCovers('medium', 'NA')).toBe(true);
    expect(drawable?.style.fontFamily).toBe('SpecialGothic-Medium');

    const missing = initialsOf(draw({ size: 'lg', image: null, name: 'Ễn Ước', handle: null }));
    expect(fontCovers('medium', 'ỄƯ')).toBe(false);
    expect(missing?.textContent).toBe('ỄƯ');
    expect(missing?.style.fontFamily).not.toMatch(/SpecialGothic/);
    expect(missing?.style.textTransform).toBe('uppercase');
  });
});
