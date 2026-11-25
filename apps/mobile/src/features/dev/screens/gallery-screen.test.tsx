import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';
import { renderWithProviders } from '@/test/render';
import * as avatarFixtures from '@/ui/components/avatar.fixtures';
import * as buttonFixtures from '@/ui/components/button.fixtures';
import * as countBadgeFixtures from '@/ui/components/count-badge.fixtures';
import * as dialogFixtures from '@/ui/components/dialog.fixtures';
import * as emptyChairFixtures from '@/ui/components/empty-chair.fixtures';
import * as emptyStateFixtures from '@/ui/components/empty-state.fixtures';
import * as feedRuleFixtures from '@/ui/components/feed-rule.fixtures';
import * as iconButtonFixtures from '@/ui/components/icon-button.fixtures';
import * as iconFixtures from '@/ui/components/icon.fixtures';
import * as linkFixtures from '@/ui/components/link.fixtures';
import * as listFixtures from '@/ui/components/list.fixtures';
import * as noticeFixtures from '@/ui/components/notice.fixtures';
import * as pressableFixtures from '@/ui/components/pressable.fixtures';
import * as ruleFixtures from '@/ui/components/rule.fixtures';
import * as screenFixtures from '@/ui/components/screen.fixtures';
import * as sheetFixtures from '@/ui/components/sheet.fixtures';
import * as skeletonFixtures from '@/ui/components/skeleton.fixtures';
import * as systemScreenFixtures from '@/ui/components/system-screen.fixtures';
import * as textFixtures from '@/ui/components/text.fixtures';
import * as toastFixtures from '@/ui/components/toast.fixtures';
import * as tooltipFixtures from '@/ui/components/tooltip.fixtures';
import * as wordmarkFixtures from '@/ui/components/wordmark.fixtures';
import * as appBarFixtures from '@/ui/shells/app-bar.fixtures';
import * as appShellFixtures from '@/ui/shells/app-shell.fixtures';
import * as railFixtures from '@/ui/shells/rail.fixtures';
import * as rightColumnFixtures from '@/ui/shells/right-column.fixtures';
import * as tabBarFixtures from '@/ui/shells/tab-bar.fixtures';

import { GalleryScreen } from './gallery-screen';
import type { GalleryScreenProps } from './gallery-screen';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
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

/** Every state of C-AppShell through each of its three layouts: `signedOutHome` at compact is `compactSignedOutHome`. */
const SHELL_STATES: readonly string[] = ['compact', 'medium', 'expanded'].flatMap((layout) =>
  Object.keys(appShellFixtures.STATES).map(
    (state) => `${layout}${state.charAt(0).toUpperCase()}${state.slice(1)}`,
  ),
);

/**
 * Every section in the order of the design system, the shells before the components: id, kebab name
 * and the states of its fixtures.
 */
const COMPONENTS: readonly { id: string; slug: string; states: readonly string[] }[] = [
  { id: 'Shells', slug: 'shells', states: SHELL_STATES },
  { id: 'C-TabBar', slug: 'tab-bar', states: Object.keys(tabBarFixtures.STATES) },
  { id: 'C-Rail', slug: 'rail', states: Object.keys(railFixtures.STATES) },
  { id: 'C-AppBar', slug: 'app-bar', states: Object.keys(appBarFixtures.STATES) },
  { id: 'C-RightColumn', slug: 'right-column', states: Object.keys(rightColumnFixtures.STATES) },
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
  { id: 'C-Wordmark', slug: 'wordmark', states: Object.keys(wordmarkFixtures.STATES) },
  { id: 'C-EmptyChair', slug: 'empty-chair', states: Object.keys(emptyChairFixtures.STATES) },
  { id: 'C-Notice', slug: 'notice', states: Object.keys(noticeFixtures.STATES) },
  { id: 'C-Skeleton', slug: 'skeleton', states: Object.keys(skeletonFixtures.STATES) },
  { id: 'C-EmptyState', slug: 'empty-state', states: Object.keys(emptyStateFixtures.STATES) },
  { id: 'C-Screen', slug: 'screen', states: Object.keys(screenFixtures.STATES) },
  { id: 'C-List', slug: 'list', states: Object.keys(listFixtures.STATES) },
  { id: 'C-SystemScreen', slug: 'system-screen', states: Object.keys(systemScreenFixtures.STATES) },
  { id: 'C-Sheet', slug: 'sheet', states: Object.keys(sheetFixtures.STATES) },
  { id: 'C-Dialog', slug: 'dialog', states: Object.keys(dialogFixtures.STATES) },
  { id: 'C-Tooltip', slug: 'tooltip', states: Object.keys(tooltipFixtures.STATES) },
  { id: 'C-Toast', slug: 'toast', states: Object.keys(toastFixtures.STATES) },
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

/** What a specimen draws: everything inside a cell, under the state's name. */
const CELL = '[data-testid^="gallery.cell-"]';

/** True for an element the gallery draws itself, outside every specimen. */
function ownElement(element: HTMLElement): boolean {
  return element.closest(CELL) === null;
}

/**
 * The gallery's own level 2 headings, one for each section, in the order they are drawn. A specimen
 * may draw headings of its own, which are not the gallery's.
 */
function sectionHeadingElements(): HTMLElement[] {
  return screen.queryAllByRole('heading', { level: 2 }).filter(ownElement);
}

/** The text of the gallery's own level 2 headings, in the order they are drawn. */
function sectionHeadings(): (string | null)[] {
  return sectionHeadingElements().map((heading) => heading.textContent);
}

function cells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(CELL)];
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
      'Shells',
      'C-TabBar',
      'C-Rail',
      'C-AppBar',
      'C-RightColumn',
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
      'C-Wordmark',
      'C-EmptyChair',
      'C-Notice',
      'C-Skeleton',
      'C-EmptyState',
      'C-Screen',
      'C-List',
      'C-SystemScreen',
      'C-Sheet',
      'C-Dialog',
      'C-Tooltip',
      'C-Toast',
    ]);
    expect(COMPONENTS.map((component) => component.id)).toEqual(sectionHeadings());
    // The gallery's own heading is the page's, and the page has one main landmark of its own, which
    // holds every specimen. A specimen of a shell or a screen draws its own landmark, as it ships.
    expect(screen.getByRole('heading', { level: 1, name: 'Gallery' })).toBeDefined();
    const main = screen.getAllByRole('main').filter(ownElement);
    expect(main).toHaveLength(1);
    for (const cell of cells()) {
      expect(main[0]?.contains(cell), cell.dataset.testid).toBe(true);
    }
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
    const headings = sectionHeadingElements();
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

  it('keeps its heading clear of the status bar', () => {
    cleanup();
    renderWithProviders(
      <SafeAreaInsetsContext.Provider value={{ top: 47, right: 0, bottom: 34, left: 0 }}>
        <GalleryScreen {...DEFAULTS} only="rule" />
      </SafeAreaInsetsContext.Provider>,
    );
    // The top inset stands above the page, on its ground, and the page scrolls under it.
    const strip = screen.getByTestId('gallery.scroll').previousElementSibling;
    if (!(strip instanceof HTMLElement)) {
      throw new Error('nothing stands above the page');
    }
    expect(strip.style.height).toBe('47px');
    expect(strip.style.backgroundColor).toBe(written('#F1EFE7'));
    expect(strip.contains(screen.getByRole('heading', { level: 1 }))).toBe(false);

    // With no inset, as on the web, the page is the first thing drawn.
    draw({ only: 'rule' });
    expect(screen.getByTestId('gallery.scroll').previousElementSibling).toBeNull();
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
