import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';
import { color, gutter, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { FIXTURE_ALT_TEXT } from './__fixtures__/fixture-canvas';
import { CardShell } from './card-shell';
import type { CardShellProps } from './card-shell';
import { GROUND, PREVIEW, STATES } from './card-shell.fixtures';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// Neither a canvas nor an icon loads an asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a card loads no asset');
  },
}));

// The window the card reads: a phone unless a case sets another.
const windowSize = vi.hoisted(() => {
  const state: { width: number; height: number } = { width: 390, height: 844 };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout =>
      actual.layoutFor({ ...windowSize, fontScale: 1, topBarHeight: 0 }),
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'canvas',
  'withMenu',
  'noHref',
  'titleLink',
  'longReason',
  'noActions',
  'loading',
] as const;

const ALL: Readonly<Record<StateName, CardShellProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const OFFICE_PAGE = '/office/fixture-county-treasurer';
const REASON = 'In your county';
const MATCH = 'Matches Property taxes';
const CLOSING = 'Filing closes Fri, Nov 27. Confirm with your election office.';
const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one card, in place of whatever was drawn before, at the given window. */
function draw(
  props: CardShellProps,
  options: RenderWithProvidersOptions = {},
  at: { width: number; height: number } = PHONE,
): HTMLElement {
  cleanup();
  windowSize.width = at.width;
  windowSize.height = at.height;
  renderWithProviders(<CardShell {...props} />, options);
  return screen.getByTestId(props.loading === true ? `${props.testID}-loading` : props.testID);
}

/** The header row of a card: the row as high as a card's header. */
function headerOf(card: HTMLElement): HTMLElement {
  const header = [...card.children].find(
    (part): part is HTMLElement =>
      part instanceof HTMLElement && part.style.minHeight === `${String(size.cardHeaderMin)}px`,
  );
  if (header === undefined) {
    throw new Error('the card draws no header row');
  }
  return header;
}

/** The meta block of a card: its last part. */
function metaOf(card: HTMLElement): HTMLElement {
  const meta = card.lastElementChild;
  if (!(meta instanceof HTMLElement)) {
    throw new Error('the card draws no meta block');
  }
  return meta;
}

/** The 4:5 ground inside a card's box. */
function groundOf(box: HTMLElement): HTMLElement {
  const ground = [box, ...box.querySelectorAll<HTMLElement>('*')].find((part) =>
    /aspect-ratio: ?0\.8\b/.test(part.getAttribute('style') ?? ''),
  );
  if (ground === undefined) {
    throw new Error('the box draws no 4:5 ground');
  }
  return ground;
}

describe('CardShell', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const at of [PHONE, DESKTOP]) {
          for (const state of STATE_NAMES) {
            const props = ALL[state];
            const card = draw(props, { theme, textScale: scale }, at);
            const name = `${state} ${theme} ${String(scale)} ${String(at.width)}`;
            if (state === 'loading') {
              expect(within(card).getByRole('progressbar'), name).toBeTruthy();
              continue;
            }
            // The reason in `label`, in the text color, and the canvas on the surface.
            const title = within(card).getByText(props.header.title);
            expect(title.style.color, name).toBe(written(color[theme].text));
            expect(parseFloat(title.style.fontSize), name).toBeCloseTo(
              (typography.label.style.fontSize ?? 0) * scale,
            );
            const ground = groundOf(screen.getByTestId(`${props.testID}-box`));
            expect(ground.style.backgroundColor, name).toBe(written(color[theme].surface));
            expect(ground.querySelector('svg'), name).not.toBeNull();
            // No rule runs round the box and no corner is rounded.
            expect(ground.style.borderWidth, name).toBe('');
            expect(ground.style.borderRadius, name).toBe('0px');
          }
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.card-shell-${kebab(state)}`);
      expect(ALL[state].box.altText, state).toBe(FIXTURE_ALT_TEXT.known);
    }
    expect(STATES.canvas.header.title).toBe(REASON);
    expect(STATES.canvas.href).toBe(OFFICE_PAGE);
    expect(STATES.canvas.header.onOpenMenu).toBeNull();
    expect(STATES.withMenu.header.onOpenMenu).toBeTypeOf('function');
    expect('href' in STATES.noHref).toBe(false);
    expect(STATES.titleLink.header.titleHref).toBe(OFFICE_PAGE);
    expect(STATES.longReason.header.title).toBe(
      'In your county and in the districts you follow around Fixture Alder',
    );
    expect(STATES.noActions.actions).toBeNull();
    expect(STATES.loading.loading).toBe(true);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      if (state === 'loading') continue;
      const card = draw(ALL[state]);
      expect(card.getAttribute('role'), state).toBe('group');
      // The box says the alt text of its canvas, whatever it is.
      const box = screen.getByTestId(`${ALL[state].testID}-box`);
      expect(box.getAttribute('aria-label'), state).toBe(FIXTURE_ALT_TEXT.known);
      expect(box.getAttribute('role'), state).toBe(state === 'noHref' ? 'img' : 'link');
    }
    // A loading card is one busy progress bar.
    const loading = draw(STATES.loading);
    expect(within(loading).getByRole('progressbar').getAttribute('aria-busy')).toBe('true');
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      draw(props);
      expect(props.testID, state).toMatch(TEST_ID);
      const ids = [...document.querySelectorAll('[data-testid]')].map((part) =>
        String(part.getAttribute('data-testid')),
      );
      // Every part is named after the card, and no id is given twice.
      expect(new Set(ids).size, state).toBe(ids.length);
      for (const id of ids) {
        expect(id.startsWith(props.testID), `${state} ${id}`).toBe(true);
      }
      expect(ids, state).toContain(state === 'loading' ? `${props.testID}-loading` : props.testID);
    }
  });

  it('respects reduced motion', () => {
    // The shell itself never moves, and a press on the box neither scales nor fills it (MO-press).
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        if (state === 'loading') continue;
        const props = ALL[state];
        draw(props, { reducedMotion });
        const box = screen.getByTestId(`${props.testID}-box`);
        fireEvent.pointerDown(box);
        fireEvent.mouseDown(box);
        for (const part of [box, ...box.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
        const header = headerOf(screen.getByTestId(props.testID));
        expect(header.style.transform, state).toBe('');
        expect(header.style.animationName, state).toBe('');
      }
    }
    // The skeleton of a loading card holds still under reduced motion.
    const held = within(draw(STATES.loading, { reducedMotion: true })).getByRole('progressbar');
    expect(['', '1']).toContain(held.style.opacity);
    expect(held.style.animationName).toBe('');
  });

  it('header row', () => {
    const card = draw(STATES.canvas);
    const header = headerOf(card);
    expect(header.style.minHeight).toBe(`${String(size.cardHeaderMin)}px`);
    expect(header.style.flexDirection).toBe('row');
    expect(header.style.alignItems).toBe('center');
    expect(header.style.paddingTop).toBe(`${String(space.x2)}px`);
    // The leading tile first: a 36-point ink square.
    const tile = header.firstElementChild;
    expect(tile instanceof HTMLElement && tile.querySelector('svg') !== null).toBe(true);
    const tileBox = [tile, ...(tile?.querySelectorAll('*') ?? [])].find(
      (part): part is HTMLElement =>
        part instanceof HTMLElement && part.style.width === `${String(size.officeTile.md)}px`,
    );
    expect(tileBox?.style.height).toBe(`${String(size.officeTile.md)}px`);
    // The reason in `label` on one line, then the subtitle in grey `caption`.
    const title = within(header).getByText(REASON);
    expect(title.style.fontFamily).toContain(String(typography.label.style.fontFamily));
    expect(parseFloat(title.style.fontSize)).toBe(typography.label.style.fontSize);
    expect(window.getComputedStyle(title).whiteSpace).toBe('nowrap');
    const subtitle = within(header).getByText(MATCH);
    expect(parseFloat(subtitle.style.fontSize)).toBe(typography.caption.style.fontSize);
    expect(subtitle.style.color).toBe(written(color.light.textSecondary));
    expect(title.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A long reason stays on its one line.
    const long = within(headerOf(draw(STATES.longReason))).getByText(
      STATES.longReason.header.title,
    );
    expect(window.getComputedStyle(long).whiteSpace).toBe('nowrap');
    expect(window.getComputedStyle(long).textOverflow).toBe('ellipsis');
  });

  it('menu only when asked', () => {
    const onOpenMenu = vi.fn();
    draw({ ...STATES.withMenu, header: { ...STATES.withMenu.header, onOpenMenu } });
    const menu = screen.getByRole('button', { name: 'More actions' });
    expect(menu.getAttribute('data-testid')).toBe('gallery.card-shell-with-menu-menu');
    fireEvent.click(menu);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);

    draw(STATES.canvas);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByTestId('gallery.card-shell-canvas-menu')).toBeNull();
  });

  it('the box is a link named by its alt text', () => {
    draw(STATES.canvas);
    const box = screen.getByRole('link', { name: FIXTURE_ALT_TEXT.known });
    expect(box.getAttribute('data-testid')).toBe('gallery.card-shell-canvas-box');
    expect(box.getAttribute('href')).toBe(OFFICE_PAGE);
    expect(screen.getAllByRole('link')).toEqual([box]);
    // The canvas inside reaches no screen reader.
    const ground = groundOf(box);
    expect(ground.getAttribute('aria-hidden')).toBe('true');
    expect(ground.querySelector('svg')).not.toBeNull();
    // 4:5 at the layout's canvas width: the phone's window.
    expect(ground.getAttribute('style')).toMatch(/aspect-ratio: ?0\.8\b/);
    expect(ground.style.width).toBe(`${String(PHONE.width)}px`);
  });

  it('no href, no link', () => {
    draw(STATES.noHref);
    const box = screen.getByRole('img', { name: FIXTURE_ALT_TEXT.known });
    expect(box.getAttribute('data-testid')).toBe('gallery.card-shell-no-href-box');
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.querySelector('[href]')).toBeNull();
    expect(groundOf(box).getAttribute('aria-hidden')).toBe('true');
  });

  it('title link', () => {
    draw(STATES.titleLink);
    const title = screen.getByTestId('gallery.card-shell-title-link-title');
    expect(title.getAttribute('role')).toBe('link');
    expect(title.getAttribute('href')).toBe(OFFICE_PAGE);
    expect(within(title).getByText(REASON)).toBeTruthy();
    // Without it the title is plain text.
    draw(STATES.canvas);
    expect(screen.queryByTestId('gallery.card-shell-canvas-title')).toBeNull();
    expect(screen.getByText(REASON).closest('[role="link"]')).toBeNull();
  });

  it('loading is a skeleton only', () => {
    const loading = draw(STATES.loading);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    // The skeleton of a card: a header, a 4:5 block and two lines.
    expect(loading.innerHTML).toContain('aspect-ratio');
    expect(loading.textContent).toBe('');
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.queryByText(CLOSING)).toBeNull();
    expect(screen.queryByTestId('gallery.card-shell-loading')).toBeNull();
    expect(screen.queryByTestId('gallery.card-shell-loading-box')).toBeNull();
    expect(screen.queryByTestId('gallery.card-shell-loading-actions')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(loading.querySelector('svg')).toBeNull();
  });

  it('reading order', () => {
    const card = draw(STATES.canvas);
    const parts = [...card.children];
    const header = headerOf(card);
    const box = screen.getByTestId('gallery.card-shell-canvas-box');
    const actions = screen.getByTestId('gallery.card-shell-canvas-actions');
    const meta = metaOf(card);
    const place = (part: HTMLElement): number =>
      parts.findIndex((child) => child === part || child.contains(part));
    expect([place(header), place(box), place(actions), place(meta)]).toEqual([0, 1, 2, 3]);
    expect(parts).toHaveLength(4);
    expect(within(meta).getByText(CLOSING)).toBeTruthy();
    expect(within(meta).getByText('$50 to file.')).toBeTruthy();
    expect(meta.style.rowGap).toBe(`${String(space.x2)}px`);
    expect(meta.style.paddingBottom).toBe(`${String(space.x6)}px`);
    // With no action row the meta follows the box.
    const bare = draw(STATES.noActions);
    expect(bare.children).toHaveLength(3);
  });

  it('gutters by layout', () => {
    // Compact: the header and the meta carry the gutter, and the box is the window's width.
    const phone = draw(STATES.canvas, {}, PHONE);
    expect(headerOf(phone).style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(headerOf(phone).style.paddingRight).toBe(`${String(gutter.regular)}px`);
    expect(metaOf(phone).style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(metaOf(phone).style.paddingRight).toBe(`${String(gutter.regular)}px`);
    expect(groundOf(screen.getByTestId('gallery.card-shell-canvas-box')).style.width).toBe(
      `${String(PHONE.width)}px`,
    );
    expect(phone.style.width).toBe(`${String(PHONE.width)}px`);

    // A small phone takes the narrow gutter.
    const small = draw(STATES.canvas, {}, { width: 360, height: 740 });
    expect(headerOf(small).style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
    expect(metaOf(small).style.paddingLeft).toBe(`${String(gutter.narrow)}px`);

    // Expanded: neither carries a gutter, and the box is the canvas width of the layout.
    const desktop = draw(STATES.canvas, {}, DESKTOP);
    const canvasWidth = Math.min(
      size.feedColumn,
      0.8 * (DESKTOP.height - size.desktopCanvasReserve),
    );
    expect(headerOf(desktop).style.paddingLeft).toBe('0px');
    expect(headerOf(desktop).style.paddingRight).toBe('0px');
    expect(metaOf(desktop).style.paddingLeft).toBe('0px');
    expect(metaOf(desktop).style.paddingRight).toBe('0px');
    const ground = groundOf(screen.getByTestId('gallery.card-shell-canvas-box'));
    expect(parseFloat(ground.style.width)).toBeCloseTo(canvasWidth);
    expect(parseFloat(ground.style.width)).toBeLessThan(DESKTOP.width);
    expect(parseFloat(desktop.style.width)).toBeCloseTo(canvasWidth);
  });
});
