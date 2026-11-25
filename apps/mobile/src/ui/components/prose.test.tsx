import { cleanup, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { Prose } from './prose';
import type { ProseProps } from './prose';
import { GROUND, PREVIEW, STATES } from './prose.fixtures';

// The props each native Text receives: the web writes "can be selected" as a class, not as a style.
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

const STATE_NAMES = ['aboutPage', 'paragraphsOnly'] as const;

const ALL: Readonly<Record<StateName, ProseProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const LINK = 'gallery.prose-about-page-rules';
const LINK_WORDS = 'filing rules';
const FIGURE_SPACE = ' ';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one page of prose and returns its column. */
function draw(props: ProseProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  texts.props = [];
  renderWithProviders(<Prose testID="probe.prose" {...props} />, options);
  return screen.getByTestId(props.testID ?? 'probe.prose');
}

describe('Prose', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const column = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // One column, no wider than a line reads well, however wide the page is.
          expect(column.style.maxWidth, name).toBe('640px');
          expect(column.style.width, name).toBe('100%');
          expect(column.childElementCount, name).toBe(ALL[state].blocks.length);
          // Running text: the body role, in the text color, left-aligned.
          for (const block of ALL[state].blocks) {
            if (block.kind !== 'paragraph' || typeof block.text !== 'string') {
              continue;
            }
            const paragraph = screen.getByText(block.text);
            expect(parseFloat(paragraph.style.fontSize), name).toBeCloseTo(16 * scale);
            expect(parseFloat(paragraph.style.lineHeight), name).toBeCloseTo(22 * scale);
            expect(paragraph.style.color, name).toBe(written(color[theme].text));
            expect(paragraph.style.textAlign, name).toBe('');
            expect(paragraph.parentElement?.style.marginBottom, name).toBe('12px');
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the two states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.aboutPage.testID).toBe('gallery.prose-about-page');
    expect(STATES.paragraphsOnly.testID).toBe('gallery.prose-paragraphs-only');
    expect(STATES.aboutPage.blocks.map((block) => block.kind)).toEqual([
      'title',
      'paragraph',
      'heading',
      'paragraph',
      'list',
      'heading',
      'paragraph',
      'list',
    ]);
    expect(STATES.paragraphsOnly.blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
    ]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    const page = draw(STATES.aboutPage);
    // The column itself is not a landmark and has no name: the screen names the page.
    expect(page.getAttribute('role')).toBeNull();
    expect(page.getAttribute('aria-label')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('About the numbers');
    expect(screen.getByRole('link', { name: LINK_WORDS })).toBe(screen.getByTestId(LINK));
    // Paragraphs alone carry no role at all.
    const plain = draw(STATES.paragraphsOnly);
    expect(plain.querySelectorAll('[role]')).toHaveLength(0);
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const column = draw(ALL[state]);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(column.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // Everything a person can press carries an id.
      for (const element of column.querySelectorAll('a, button, [role="link"]')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
    // A page without an id draws none.
    cleanup();
    const view = renderWithProviders(<Prose blocks={STATES.paragraphsOnly.blocks} />);
    expect(view.container.querySelectorAll('[data-testid]')).toHaveLength(0);
  });

  it('respects reduced motion', () => {
    // Prose never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={{ pressed: true }}>
            <Prose {...ALL[state]} />
          </InteractionPreview>,
          { reducedMotion },
        );
        for (const part of view.container.querySelectorAll<HTMLElement>('*')) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('structure', () => {
    const page = draw(STATES.aboutPage);
    // One title and the two section headings, in reading order.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Where a figure comes from', 'When 2 sources disagree']);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    // The two lists, each with its items.
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    }
    // Every text of the page can be selected; the link's own words are the link's.
    const own = texts.props.filter((props) => props['children'] !== LINK_WORDS);
    expect(own.length).toBeGreaterThanOrEqual(13);
    for (const props of own) {
      expect(props['selectable'], JSON.stringify(props['children'])).toBe(true);
    }
    // The link stands inside its sentence, with its own role.
    const link = screen.getByRole('link', { name: LINK_WORDS });
    expect(link.getAttribute('href')).toBe('/dev/gallery');
    expect(link.closest('[dir="auto"]')?.textContent).toBe(
      'The earlier date is shown, and both sources are listed. The steps are set out in the filing rules.',
    );
    expect(page.contains(link)).toBe(true);
  });

  it('the space around a title, a heading and a paragraph', () => {
    draw(STATES.aboutPage);
    const title = screen.getByRole('heading', { level: 1 });
    expect(parseFloat(title.style.fontSize)).toBe(28);
    expect(title.parentElement?.style.marginBottom).toBe('24px');
    for (const heading of screen.getAllByRole('heading', { level: 2 })) {
      expect(parseFloat(heading.style.fontSize)).toBe(20);
      expect(heading.parentElement?.style.marginTop).toBe('32px');
      expect(heading.parentElement?.style.marginBottom).toBe('12px');
    }
    // A heading that opens the column keeps no room above it.
    draw({ blocks: [{ kind: 'heading', text: 'Filing dates' }] });
    const first = screen.getByRole('heading', { level: 2 });
    expect(first.parentElement?.style.marginTop).toBe('');
    expect(first.parentElement?.style.marginBottom).toBe('12px');
  });

  it('an unordered list marks each item with a small square', () => {
    for (const scale of [1, 1.3]) {
      draw(STATES.aboutPage, { textScale: scale });
      const list = screen.getAllByRole('list')[0];
      if (list === undefined) {
        throw new Error('the page draws no list');
      }
      for (const item of within(list).getAllByRole('listitem')) {
        const square = item.firstElementChild?.firstElementChild as HTMLElement;
        expect(square.style.width).toBe('4px');
        expect(square.style.height).toBe('4px');
        expect(square.style.borderRadius).toBe('0px');
        expect(square.style.backgroundColor).toBe(written(color.light.text));
        // At the middle of the item's first line, at the text size in use.
        expect(parseFloat(square.style.marginTop)).toBeCloseTo((22 * scale - 4) / 2);
        expect(square.textContent).toBe('');
      }
    }
  });

  it('an ordered list numbers its items, and the numbers take the same room', () => {
    draw(STATES.aboutPage);
    const ordered = screen.getAllByRole('list')[1];
    if (ordered === undefined) {
      throw new Error('the page draws no ordered list');
    }
    const numbers = within(ordered)
      .getAllByRole('listitem')
      .map((item) => item.firstElementChild?.textContent);
    expect(numbers).toEqual(['1.', '2.', '3.']);
    for (const item of within(ordered).getAllByRole('listitem')) {
      const number = item.firstElementChild?.firstElementChild as HTMLElement;
      expect(number.style.fontVariantNumeric).toBe('tabular-nums');
    }
    // From ten items up, a shorter number keeps a figure's room where it has no digit.
    const items = Array.from({ length: 10 }, (_, index) => `Step ${String(index + 1)}`);
    draw({ blocks: [{ kind: 'list', ordered: true, items }] });
    const long = within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((item) => item.firstElementChild?.textContent);
    expect(long[0]).toBe(`${FIGURE_SPACE}1.`);
    expect(long[8]).toBe(`${FIGURE_SPACE}9.`);
    expect(long[9]).toBe('10.');
  });
});
