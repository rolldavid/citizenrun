import { typeRoles } from '@citizenrun/shared';
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { color, opacity, radius, size, space } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { Skeleton } from './skeleton';
import type { SkeletonProps } from './skeleton';
import { GROUND, PREVIEW, STATES } from './skeleton.fixtures';

const STATE_NAMES = ['block', 'circle', 'line', 'lines3', 'canvas', 'card', 'row', 'cell'] as const;

/** A text bar is 60% of the body line. */
const BAR = `${String(typeRoles.body.lineHeight * 0.6)}px`;
const CIRCLE = `${String(size.avatar.sm)}px`;

type Drawn = {
  /** The one animated wrapper: the progress bar. */
  wrapper: HTMLElement;
  /** The view that hides the blocks from screen readers. */
  hidden: HTMLElement;
  /** Every flat block, in drawing order. */
  blocks: HTMLElement[];
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function parts(container: HTMLElement): Drawn {
  const wrapper = container.querySelector<HTMLElement>('[role="progressbar"]');
  const hidden = wrapper?.querySelector<HTMLElement>('[aria-hidden="true"]') ?? null;
  if (wrapper === null || hidden === null) {
    throw new Error('no skeleton was drawn');
  }
  const blocks = [...hidden.querySelectorAll<HTMLElement>('*')].filter(
    (element) => element.style.backgroundColor !== '',
  );
  return { wrapper, hidden, blocks };
}

/** Renders one skeleton, in place of whatever was drawn before, and finds its parts. */
function draw(props: SkeletonProps, options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  return parts(renderWithProviders(<Skeleton {...props} />, options).container);
}

/** The bars of a skeleton: its blocks as tall as a text bar. */
function barsOf(drawn: Drawn): HTMLElement[] {
  return drawn.blocks.filter((block) => block.style.height === BAR);
}

function circlesOf(drawn: Drawn): HTMLElement[] {
  return drawn.blocks.filter((block) => block.style.borderRadius === `${String(radius.full)}px`);
}

/** The 4:5 blocks: a canvas or a grid cell. */
function canvasesOf(drawn: Drawn): HTMLElement[] {
  return drawn.blocks.filter((block) =>
    (block.getAttribute('style') ?? '').includes('aspect-ratio'),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Skeleton', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <Skeleton {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        const drawn = parts(view.container);
        expect(drawn.blocks.length, state).toBeGreaterThan(0);
        for (const block of drawn.blocks) {
          // Flat blocks of one color: no gradient, no shimmer, no picture.
          expect(block.style.backgroundColor, state).toBe(written(color[theme].skeleton));
          expect(block.style.backgroundImage, state).toBe('');
          expect(block.children, state).toHaveLength(0);
        }
        // Never a spinner.
        expect(view.container.querySelectorAll('svg, img'), state).toHaveLength(0);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the eight states', () => {
    expect(STATES).toEqual({
      block: { shape: 'block' },
      circle: { shape: 'circle' },
      line: { shape: 'line' },
      lines3: { shape: 'line', lines: 3 },
      canvas: { shape: 'canvas' },
      card: { shape: 'card' },
      row: { shape: 'row' },
      cell: { shape: 'cell', width: size.canvasMinCell },
    });
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('is one progressbar named Loading and busy', () => {
    for (const state of STATE_NAMES) {
      const { wrapper } = draw(STATES[state]);
      expect(document.querySelectorAll('[role="progressbar"]'), state).toHaveLength(1);
      expect(wrapper.getAttribute('aria-label'), state).toBe('Loading');
      expect(wrapper.getAttribute('aria-busy'), state).toBe('true');
      // One group carries the state: nothing inside repeats it.
      expect(wrapper.querySelectorAll('[aria-busy], [aria-label]'), state).toHaveLength(0);
    }
  });

  it('hides its blocks', () => {
    for (const state of STATE_NAMES) {
      const { wrapper, hidden, blocks } = draw(STATES[state]);
      expect(hidden.parentElement, state).toBe(wrapper);
      for (const block of blocks) {
        expect(hidden.contains(block), state).toBe(true);
        expect(block.getAttribute('role'), state).toBeNull();
      }
      expect(hidden.querySelectorAll('[role]'), state).toHaveLength(0);
    }
  });

  it('draws the number of lines asked', () => {
    const three = draw(STATES.lines3);
    expect(three.blocks).toHaveLength(3);
    expect(three.blocks.map((bar) => bar.style.width)).toEqual(['100%', '100%', '60%']);
    for (const bar of three.blocks) {
      expect(bar.style.height).toBe(BAR);
    }
    expect(three.blocks[0]?.parentElement?.style.gap).toBe(`${String(space.x2)}px`);
    // One line is a last line: it stops short.
    const one = draw(STATES.line);
    expect(one.blocks.map((bar) => bar.style.width)).toEqual(['60%']);
    expect(draw({ shape: 'line', lines: 5 }).blocks).toHaveLength(5);
  });

  it('a block is a rectangle of the width and height asked, a list row high by default', () => {
    const plain = draw(STATES.block);
    expect(plain.blocks).toHaveLength(1);
    expect(plain.blocks[0]?.style.width).toBe('100%');
    expect(plain.blocks[0]?.style.height).toBe(`${String(size.listRowMin)}px`);
    expect(plain.wrapper.style.alignSelf).toBe('stretch');
    expect(draw({ shape: 'block', width: 'full' }).blocks[0]?.style.width).toBe('100%');
    // A given width is the skeleton's own, and the block fills it.
    const sized = draw({ shape: 'block', width: size.rightColumn, height: size.target });
    expect(sized.wrapper.style.width).toBe(`${String(size.rightColumn)}px`);
    expect(sized.wrapper.style.alignSelf).toBe('flex-start');
    expect(sized.blocks[0]?.style.width).toBe('100%');
    expect(sized.blocks[0]?.style.height).toBe(`${String(size.target)}px`);
  });

  it('a circle is the size of a small avatar', () => {
    const { wrapper, blocks } = draw(STATES.circle);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.style.width).toBe(CIRCLE);
    expect(blocks[0]?.style.height).toBe(CIRCLE);
    expect(blocks[0]?.style.borderRadius).toBe(`${String(radius.full)}px`);
    expect(wrapper.style.alignSelf).toBe('flex-start');
  });

  it('a canvas is a 4:5 block at full width and a cell one at the width given', () => {
    const canvas = draw(STATES.canvas);
    expect(canvas.blocks).toHaveLength(1);
    expect(canvasesOf(canvas)).toHaveLength(1);
    expect(canvas.blocks[0]?.getAttribute('style')).toMatch(/aspect-ratio: ?0\.8\b/);
    expect(canvas.blocks[0]?.style.width).toBe('100%');
    expect(canvas.wrapper.style.alignSelf).toBe('stretch');

    const cell = draw(STATES.cell);
    expect(canvasesOf(cell)).toHaveLength(1);
    expect(cell.blocks[0]?.getAttribute('style')).toMatch(/aspect-ratio: ?0\.8\b/);
    expect(cell.wrapper.style.width).toBe(`${String(size.canvasMinCell)}px`);
    expect(cell.blocks[0]?.style.width).toBe('100%');
    // With no width a cell fills the grid cell it stands in.
    expect(draw({ shape: 'cell' }).wrapper.style.alignSelf).toBe('stretch');
  });

  it('a card is an avatar, two short lines, a canvas and two lines', () => {
    const card = draw(STATES.card);
    expect(card.blocks).toHaveLength(6);
    expect(circlesOf(card)).toHaveLength(1);
    expect(canvasesOf(card)).toHaveLength(1);
    expect(barsOf(card).map((bar) => bar.style.width)).toEqual(['40%', '25%', '100%', '60%']);
    // In reading order: the header, the canvas, the lines.
    const [avatar, name, , canvas, first] = card.blocks;
    expect(avatar?.style.width).toBe(CIRCLE);
    expect(avatar?.parentElement).toBe(name?.parentElement?.parentElement);
    expect(avatar?.parentElement?.style.flexDirection).toBe('row');
    expect(avatar?.parentElement?.style.gap).toBe(`${String(space.x3)}px`);
    expect(canvas?.getAttribute('style')).toContain('aspect-ratio');
    expect(canvas?.parentElement?.style.gap).toBe(`${String(space.x2)}px`);
    expect(first?.parentElement?.parentElement).toBe(canvas?.parentElement);
  });

  it('a row is an avatar and two lines, a list row high', () => {
    const row = draw(STATES.row);
    expect(row.blocks).toHaveLength(3);
    expect(circlesOf(row)).toHaveLength(1);
    expect(barsOf(row).map((bar) => bar.style.width)).toEqual(['100%', '60%']);
    const holder = row.blocks[0]?.parentElement;
    expect(holder?.style.flexDirection).toBe('row');
    expect(holder?.style.minHeight).toBe(`${String(size.listRowMin)}px`);
    expect(holder?.style.paddingTop).toBe(`${String(space.x2)}px`);
    expect(holder?.style.paddingBottom).toBe(`${String(space.x2)}px`);
  });

  it('every block but a circle has square corners', () => {
    for (const state of STATE_NAMES) {
      const drawn = draw(STATES[state]);
      const circles = circlesOf(drawn);
      for (const block of drawn.blocks.filter((each) => !circles.includes(each))) {
        expect(block.style.borderRadius, state).toBe(`${String(radius.none)}px`);
      }
    }
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const { wrapper } = draw(STATES[state]);
      // Nothing in a skeleton is pressed; its one name and role are the progress bar's.
      expect(document.querySelectorAll('a, button, [tabindex]'), state).toHaveLength(0);
      expect(wrapper.getAttribute('role'), state).toBe('progressbar');
      expect(wrapper.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
    }
  });

  it('has a testID', () => {
    // Nothing in a skeleton is interactive, so nothing carries an id.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
    }
  });

  it('pulses as one group between full and the low point', () => {
    vi.useFakeTimers();
    const { wrapper, hidden, blocks } = draw(STATES.card);
    const seen = new Set<number>();
    for (let elapsed = 0; elapsed < motion.duration.pulse * 2; elapsed += 100) {
      act(() => {
        vi.advanceTimersByTime(100);
      });
      seen.add(Number(wrapper.style.opacity === '' ? '1' : wrapper.style.opacity));
    }
    // The wrapper alone moves, down to the low point and back, and never further.
    expect(Math.min(...seen)).toBeLessThan(1);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(opacity.skeletonLow - 0.001);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    for (const part of [hidden, ...blocks]) {
      expect(part.style.opacity).toBe('');
      expect(part.style.animationName).toBe('');
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    for (const state of STATE_NAMES) {
      const { wrapper } = draw(STATES[state], { reducedMotion: true });
      expect(['', '1'], state).toContain(wrapper.style.opacity);
      act(() => {
        vi.advanceTimersByTime(motion.duration.pulse / 2);
      });
      expect(['', '1'], state).toContain(wrapper.style.opacity);
      act(() => {
        vi.advanceTimersByTime(motion.duration.pulse / 2);
      });
      expect(['', '1'], state).toContain(wrapper.style.opacity);
    }
  });
});
