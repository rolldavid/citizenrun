import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';
import { renderWithProviders } from '@/test/render';
import * as avatarFixtures from '@/ui/components/avatar.fixtures';
import * as buttonFixtures from '@/ui/components/button.fixtures';
import * as countBadgeFixtures from '@/ui/components/count-badge.fixtures';
import * as feedRuleFixtures from '@/ui/components/feed-rule.fixtures';
import * as iconButtonFixtures from '@/ui/components/icon-button.fixtures';
import * as iconFixtures from '@/ui/components/icon.fixtures';
import * as linkFixtures from '@/ui/components/link.fixtures';
import * as pressableFixtures from '@/ui/components/pressable.fixtures';
import * as ruleFixtures from '@/ui/components/rule.fixtures';
import * as textFixtures from '@/ui/components/text.fixtures';

import { GalleryScreen } from './gallery-screen';
import type { GalleryScreenProps } from './gallery-screen';

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

/** The ten components in the order of the design system: id, kebab name and the states of its fixtures. */
const COMPONENTS: readonly { id: string; slug: string; states: readonly string[] }[] = [
  { id: 'C-Text', slug: 'text', states: Object.keys(textFixtures.STATES) },
  { id: 'C-Pressable', slug: 'pressable', states: Object.keys(pressableFixtures.STATES) },
  { id: 'C-Icon', slug: 'icon', states: Object.keys(iconFixtures.STATES) },
  { id: 'C-Link', slug: 'link', states: Object.keys(linkFixtures.STATES) },
  { id: 'C-Rule', slug: 'rule', states: Object.keys(ruleFixtures.STATES) },
  { id: 'C-FeedRule', slug: 'feed-rule', states: Object.keys(feedRuleFixtures.STATES) },
  { id: 'C-Button', slug: 'button', states: Object.keys(buttonFixtures.STATES) },
  { id: 'C-IconButton', slug: 'icon-button', states: Object.keys(iconButtonFixtures.STATES) },
  { id: 'C-Avatar', slug: 'avatar', states: Object.keys(avatarFixtures.STATES) },
  { id: 'C-CountBadge', slug: 'count-badge', states: Object.keys(countBadgeFixtures.STATES) },
];

const DEFAULTS: GalleryScreenProps = {
  initialTheme: 'system',
  initialTextScale: 1,
  initialReducedMotion: null,
  only: null,
};

const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders the gallery, in place of whatever was drawn before. */
function draw(props: Partial<GalleryScreenProps> = {}): void {
  cleanup();
  renderWithProviders(<GalleryScreen {...DEFAULTS} {...props} />);
}

/** The text of the level 2 headings, in the order they are drawn. */
function sectionHeadings(): (string | null)[] {
  return screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
}

function cells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="gallery.cell-"]')];
}

/** The box a cell draws its specimen in: the cell's second child, under the state's name. */
function boxOf(testID: string): HTMLElement {
  const box = screen.getByTestId(testID).children[1];
  if (!(box instanceof HTMLElement)) {
    throw new Error(`the cell ${testID} has no box`);
  }
  return box;
}

/** The ground the gallery paints behind everything: the view its own theme provider draws. */
function ground(): string {
  const root = screen.getByTestId('gallery.scroll').parentElement;
  if (root === null) {
    throw new Error('the gallery has no ground');
  }
  return window.getComputedStyle(root).backgroundColor;
}

/** The fill of a button's own box. */
function fillOf(testID: string): string {
  const box = screen.getByTestId(testID).querySelector<HTMLElement>('[style*="min-height"]');
  if (box === null) {
    throw new Error(`the button ${testID} has no box`);
  }
  return box.style.backgroundColor;
}

/** The transforms of a specimen's press target and of everything inside it. */
function transformsOf(testID: string): string[] {
  const target = screen.getByTestId(testID);
  return [target, ...target.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform);
}

function press(testID: string): void {
  fireEvent.click(screen.getByTestId(testID));
}

describe('GalleryScreen', () => {
  it('draws every component in order', () => {
    draw();
    expect(sectionHeadings()).toEqual([
      'C-Text',
      'C-Pressable',
      'C-Icon',
      'C-Link',
      'C-Rule',
      'C-FeedRule',
      'C-Button',
      'C-IconButton',
      'C-Avatar',
      'C-CountBadge',
    ]);
    expect(COMPONENTS.map((component) => component.id)).toEqual(sectionHeadings());
    // The gallery's own heading is the page's.
    expect(screen.getByRole('heading', { level: 1, name: 'Gallery' })).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('draws every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    draw();
    const total = COMPONENTS.reduce((sum, component) => sum + component.states.length, 0);
    expect(total).toBeGreaterThan(COMPONENTS.length);
    expect(cells()).toHaveLength(total);
    expect(screen.getByTestId('gallery.cell-button-run-hover')).toBeDefined();
    // One cell for each state of each fixtures file, under the state's own name.
    for (const component of COMPONENTS) {
      for (const state of component.states) {
        const cell = screen.getByTestId(`gallery.cell-${component.slug}-${kebab(state)}`);
        expect(cell.firstElementChild?.textContent, `${component.id} ${state}`).toBe(state);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('says how many states each component has', () => {
    draw();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.nextElementSibling?.textContent)).toEqual(
      COMPONENTS.map(({ states }) =>
        states.length === 1 ? '1 state' : `${String(states.length)} states`,
      ),
    );
  });

  it('shows an interaction state forced and a state on the ground it is made for', () => {
    draw({ initialTheme: 'light' });
    // Hover, press and focus are forced from outside: no pointer is over the specimen.
    expect(fillOf('gallery.button-run')).toBe(written('#F04E14'));
    expect(fillOf('gallery.button-run-hover')).toBe(written('#E84603'));
    expect(transformsOf('gallery.button-run-pressed')).toContain(MOVED);
    expect(screen.getByTestId('gallery.button-run-focus').style.outlineStyle).toBe('solid');
    expect(screen.getByTestId('gallery.button-run').style.outlineStyle).toBe('');
    // A state with a ground of its own sits on it; every other state sits on the page's ground.
    expect(boxOf('gallery.cell-text-inverse').style.backgroundColor).toBe(written('#141412'));
    expect(boxOf('gallery.cell-text-on-accent').style.backgroundColor).toBe(written('#F04E14'));
    expect(boxOf('gallery.cell-icon-inverse').style.backgroundColor).toBe(written('#141412'));
    expect(boxOf('gallery.cell-text-body').style.backgroundColor).toBe(written('#F1EFE7'));
    for (const state of Object.keys(buttonFixtures.STATES)) {
      expect(boxOf(`gallery.cell-button-${kebab(state)}`).style.backgroundColor, state).toBe(
        written('#F1EFE7'),
      );
    }
  });

  it('only shows one section', () => {
    draw({ only: 'button' });
    expect(sectionHeadings()).toEqual(['C-Button']);
    expect(cells()).toHaveLength(Object.keys(buttonFixtures.STATES).length);
    expect(screen.queryByText(/No component named/)).toBeNull();

    draw({ only: 'icon-button' });
    expect(sectionHeadings()).toEqual(['C-IconButton']);

    draw({ only: 'nope' });
    expect(sectionHeadings()).toEqual([]);
    expect(cells()).toHaveLength(0);
    expect(screen.getByText('No component named nope.')).toBeDefined();
    // The controls stay.
    expect(screen.getByTestId('gallery.theme-dark')).toBeDefined();
  });

  it('the theme control switches the theme', () => {
    draw({ initialTheme: 'light' });
    expect(ground()).toBe(written('#F1EFE7'));
    // The chosen value is the ink button; the others are outlines with no fill.
    expect(fillOf('gallery.theme-light')).toBe(written('#141412'));
    expect(fillOf('gallery.theme-dark')).toBe('');
    expect(fillOf('gallery.theme-system')).toBe('');

    press('gallery.theme-dark');
    expect(ground()).toBe(written('#121210'));
    expect(boxOf('gallery.cell-text-body').style.backgroundColor).toBe(written('#121210'));
    expect(fillOf('gallery.theme-dark')).toBe(written('#F3F1EA'));
    expect(fillOf('gallery.theme-light')).toBe('');

    press('gallery.theme-light');
    expect(ground()).toBe(written('#F1EFE7'));
    expect(boxOf('gallery.cell-text-body').style.backgroundColor).toBe(written('#F1EFE7'));
  });

  it('opens in the theme it is given', () => {
    draw({ initialTheme: 'dark' });
    expect(ground()).toBe(written('#121210'));
    expect(fillOf('gallery.theme-dark')).toBe(written('#F3F1EA'));
  });

  it('the text control scales text', () => {
    draw();
    const specimen = (state: 'body' | 'title'): HTMLElement =>
      within(screen.getByTestId(`gallery.cell-text-${state}`)).getByText(
        textFixtures.STATES[state].children,
      );
    expect(specimen('body').style.fontSize).toBe('16px');
    expect(specimen('title').style.fontSize).toBe('28px');
    expect(fillOf('gallery.text-100')).not.toBe('');

    press('gallery.text-130');
    expect(specimen('body').style.fontSize).toBe('20.8px');
    expect(specimen('title').style.fontSize).toBe('36.4px');
    expect(fillOf('gallery.text-130')).not.toBe('');
    expect(fillOf('gallery.text-100')).toBe('');
    // Text grows; the room around it does not.
    expect(boxOf('gallery.cell-text-body').style.paddingTop).toBe('12px');
    expect(boxOf('gallery.cell-text-body').style.minHeight).toBe('44px');

    press('gallery.text-100');
    expect(specimen('body').style.fontSize).toBe('16px');
  });

  it('opens at the text scale it is given', () => {
    draw({ initialTextScale: 1.3 });
    expect(
      within(screen.getByTestId('gallery.cell-text-body')).getByText(
        textFixtures.STATES.body.children,
      ).style.fontSize,
    ).toBe('20.8px');
    expect(fillOf('gallery.text-130')).not.toBe('');
  });

  it('the motion control forces reduced motion', () => {
    draw();
    // The device asks for no reduced motion, so a pressed button is drawn moved.
    expect(transformsOf('gallery.button-run-pressed')).toContain(MOVED);
    expect(fillOf('gallery.motion-system')).not.toBe('');

    press('gallery.motion-reduced');
    for (const transform of transformsOf('gallery.button-run-pressed')) {
      expect(AT_REST).toContain(transform);
    }
    expect(fillOf('gallery.motion-reduced')).not.toBe('');
    expect(fillOf('gallery.motion-system')).toBe('');

    press('gallery.motion-system');
    expect(transformsOf('gallery.button-run-pressed')).toContain(MOVED);
  });

  it('opens with reduced motion when it is given', () => {
    draw({ initialReducedMotion: true });
    for (const transform of transformsOf('gallery.button-run-pressed')) {
      expect(AT_REST).toContain(transform);
    }
    expect(fillOf('gallery.motion-reduced')).not.toBe('');
  });

  it('the gallery sends nothing', () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    draw();
    press('gallery.theme-dark');
    press('gallery.text-130');
    press('gallery.motion-reduced');
    expect(fetched).not.toHaveBeenCalled();
    expect(sessionFake.calls).toEqual([]);
    // The one call is the key subscription of the shortcut provider the test renders around the screen.
    expect(linksFake.calls).toEqual([{ op: 'subscribeKeyDown' }]);
    fetched.mockRestore();
  });
});
