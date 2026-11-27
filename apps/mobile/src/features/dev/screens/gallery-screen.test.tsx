import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';
import { renderWithProviders, setViewport } from '@/test/render';
import { ToastHost } from '@/ui/components/toast';
import * as actionRowFixtures from '@/ui/components/action-row.fixtures';
import * as addressFieldFixtures from '@/ui/components/address-field.fixtures';
import * as ageGateFixtures from '@/ui/components/age-gate.fixtures';
import * as avatarFixtures from '@/ui/components/avatar.fixtures';
import * as bigNumberFixtures from '@/ui/components/big-number.fixtures';
import * as buttonFixtures from '@/ui/components/button.fixtures';
import * as cardShellFixtures from '@/ui/components/card-shell.fixtures';
import * as checkboxFixtures from '@/ui/components/checkbox.fixtures';
import * as codeFieldFixtures from '@/ui/components/code-field.fixtures';
import * as confidenceBadgeFixtures from '@/ui/components/confidence-badge.fixtures';
import * as countBadgeFixtures from '@/ui/components/count-badge.fixtures';
import * as deadlineBlockFixtures from '@/ui/components/deadline-block.fixtures';
import * as deadlineLineFixtures from '@/ui/components/deadline-line.fixtures';
import * as deadlineRingFixtures from '@/ui/components/deadline-ring.fixtures';
import * as dealLineFixtures from '@/ui/components/deal-line.fixtures';
import * as dialogFixtures from '@/ui/components/dialog.fixtures';
import * as emptyChairFixtures from '@/ui/components/empty-chair.fixtures';
import * as emptyStateFixtures from '@/ui/components/empty-state.fixtures';
import * as factRowFixtures from '@/ui/components/fact-row.fixtures';
import * as feedRuleFixtures from '@/ui/components/feed-rule.fixtures';
import * as flagFixtures from '@/ui/components/flag.fixtures';
import * as followButtonFixtures from '@/ui/components/follow-button.fixtures';
import * as formFieldFixtures from '@/ui/components/form-field.fixtures';
import * as handleFieldFixtures from '@/ui/components/handle-field.fixtures';
import * as iconButtonFixtures from '@/ui/components/icon-button.fixtures';
import * as iconFixtures from '@/ui/components/icon.fixtures';
import * as issueChipFixtures from '@/ui/components/issue-chip.fixtures';
import * as issueGridFixtures from '@/ui/components/issue-grid.fixtures';
import * as issueTileFixtures from '@/ui/components/issue-tile.fixtures';
import * as linkFixtures from '@/ui/components/link.fixtures';
import * as listRowFixtures from '@/ui/components/list-row.fixtures';
import * as listFixtures from '@/ui/components/list.fixtures';
import * as meterInputsFixtures from '@/ui/components/meter-inputs.fixtures';
import * as meterFixtures from '@/ui/components/meter.fixtures';
import * as miniMapStillFixtures from '@/ui/components/mini-map-still.fixtures';
import * as noticeFixtures from '@/ui/components/notice.fixtures';
import * as officeCardFixtures from '@/ui/components/office-card.fixtures';
import * as officeTileFixtures from '@/ui/components/office-tile.fixtures';
import * as personRowFixtures from '@/ui/components/person-row.fixtures';
import * as photoCreditFixtures from '@/ui/components/photo-credit.fixtures';
import * as popoverFixtures from '@/ui/components/popover.fixtures';
import * as pressableFixtures from '@/ui/components/pressable.fixtures';
import * as profileHeaderFixtures from '@/ui/components/profile-header.fixtures';
import * as progressFixtures from '@/ui/components/progress.fixtures';
import * as proseFixtures from '@/ui/components/prose.fixtures';
import * as radioGroupFixtures from '@/ui/components/radio-group.fixtures';
import * as radioFixtures from '@/ui/components/radio.fixtures';
import * as ruleFixtures from '@/ui/components/rule.fixtures';
import * as screenFixtures from '@/ui/components/screen.fixtures';
import * as sectionHeaderFixtures from '@/ui/components/section-header.fixtures';
import * as selectFixtures from '@/ui/components/select.fixtures';
import * as sheetFixtures from '@/ui/components/sheet.fixtures';
import * as skeletonFixtures from '@/ui/components/skeleton.fixtures';
import * as sourceLinkFixtures from '@/ui/components/source-link.fixtures';
import * as sourcesSheetFixtures from '@/ui/components/sources-sheet.fixtures';
import * as stickyFooterFixtures from '@/ui/components/sticky-footer.fixtures';
import * as switchFixtures from '@/ui/components/switch.fixtures';
import * as systemScreenFixtures from '@/ui/components/system-screen.fixtures';
import * as tableFixtures from '@/ui/components/table.fixtures';
import * as tagFixtures from '@/ui/components/tag.fixtures';
import * as textFieldFixtures from '@/ui/components/text-field.fixtures';
import * as textFixtures from '@/ui/components/text.fixtures';
import * as toastFixtures from '@/ui/components/toast.fixtures';
import * as tooltipFixtures from '@/ui/components/tooltip.fixtures';
import * as wordmarkFixtures from '@/ui/components/wordmark.fixtures';
import * as appBarFixtures from '@/ui/shells/app-bar.fixtures';
import * as appShellFixtures from '@/ui/shells/app-shell.fixtures';
import * as railFixtures from '@/ui/shells/rail.fixtures';
import * as rightColumnFixtures from '@/ui/shells/right-column.fixtures';
import * as tabBarFixtures from '@/ui/shells/tab-bar.fixtures';
import { ISSUE_IDS, gutter, issue, size } from '@/ui/tokens';

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

// The image library does not load in this environment: this stands in for the view an avatar draws
// its photo with.
vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>): ReactElement =>
    createElement('div', { 'data-photo': props['recyclingKey'] }),
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
  { id: 'C-Popover', slug: 'popover', states: Object.keys(popoverFixtures.STATES) },
  { id: 'C-Tooltip', slug: 'tooltip', states: Object.keys(tooltipFixtures.STATES) },
  { id: 'C-Toast', slug: 'toast', states: Object.keys(toastFixtures.STATES) },
  { id: 'C-FormField', slug: 'form-field', states: Object.keys(formFieldFixtures.STATES) },
  { id: 'C-TextField', slug: 'text-field', states: Object.keys(textFieldFixtures.STATES) },
  { id: 'C-AddressField', slug: 'address-field', states: Object.keys(addressFieldFixtures.STATES) },
  { id: 'C-HandleField', slug: 'handle-field', states: Object.keys(handleFieldFixtures.STATES) },
  { id: 'C-CodeField', slug: 'code-field', states: Object.keys(codeFieldFixtures.STATES) },
  { id: 'C-Select', slug: 'select', states: Object.keys(selectFixtures.STATES) },
  { id: 'C-Checkbox', slug: 'checkbox', states: Object.keys(checkboxFixtures.STATES) },
  { id: 'C-Radio', slug: 'radio', states: Object.keys(radioFixtures.STATES) },
  { id: 'C-RadioGroup', slug: 'radio-group', states: Object.keys(radioGroupFixtures.STATES) },
  { id: 'C-Switch', slug: 'switch', states: Object.keys(switchFixtures.STATES) },
  { id: 'C-AgeGate', slug: 'age-gate', states: Object.keys(ageGateFixtures.STATES) },
  { id: 'C-Progress', slug: 'progress', states: Object.keys(progressFixtures.STATES) },
  { id: 'C-StickyFooter', slug: 'sticky-footer', states: Object.keys(stickyFooterFixtures.STATES) },
  {
    id: 'C-SectionHeader',
    slug: 'section-header',
    states: Object.keys(sectionHeaderFixtures.STATES),
  },
  { id: 'C-ListRow', slug: 'list-row', states: Object.keys(listRowFixtures.STATES) },
  { id: 'C-PersonRow', slug: 'person-row', states: Object.keys(personRowFixtures.STATES) },
  { id: 'C-FactRow', slug: 'fact-row', states: Object.keys(factRowFixtures.STATES) },
  { id: 'C-Table', slug: 'table', states: Object.keys(tableFixtures.STATES) },
  { id: 'C-Tag', slug: 'tag', states: Object.keys(tagFixtures.STATES) },
  { id: 'C-Flag', slug: 'flag', states: Object.keys(flagFixtures.STATES) },
  {
    id: 'C-ConfidenceBadge',
    slug: 'confidence-badge',
    states: Object.keys(confidenceBadgeFixtures.STATES),
  },
  { id: 'C-SourceLink', slug: 'source-link', states: Object.keys(sourceLinkFixtures.STATES) },
  { id: 'C-SourcesSheet', slug: 'sources-sheet', states: Object.keys(sourcesSheetFixtures.STATES) },
  { id: 'C-Prose', slug: 'prose', states: Object.keys(proseFixtures.STATES) },
  { id: 'C-PhotoCredit', slug: 'photo-credit', states: Object.keys(photoCreditFixtures.STATES) },
  { id: 'C-BigNumber', slug: 'big-number', states: Object.keys(bigNumberFixtures.STATES) },
  { id: 'C-DealLine', slug: 'deal-line', states: Object.keys(dealLineFixtures.STATES) },
  { id: 'C-Meter', slug: 'meter', states: Object.keys(meterFixtures.STATES) },
  { id: 'C-MeterInputs', slug: 'meter-inputs', states: Object.keys(meterInputsFixtures.STATES) },
  { id: 'C-DeadlineRing', slug: 'deadline-ring', states: Object.keys(deadlineRingFixtures.STATES) },
  {
    id: 'C-DeadlineBlock',
    slug: 'deadline-block',
    states: Object.keys(deadlineBlockFixtures.STATES),
  },
  { id: 'C-DeadlineLine', slug: 'deadline-line', states: Object.keys(deadlineLineFixtures.STATES) },
  // After the states of its fixtures, the strip of every issue's tile.
  {
    id: 'C-IssueTile',
    slug: 'issue-tile',
    states: [...Object.keys(issueTileFixtures.STATES), 'everyIssue'],
  },
  { id: 'C-IssueChip', slug: 'issue-chip', states: Object.keys(issueChipFixtures.STATES) },
  // After the states of its fixtures, `three` again in the column of a wide window.
  {
    id: 'C-IssueGrid',
    slug: 'issue-grid',
    states: [...Object.keys(issueGridFixtures.STATES), 'threeInColumn'],
  },
  { id: 'C-OfficeTile', slug: 'office-tile', states: Object.keys(officeTileFixtures.STATES) },
  {
    id: 'C-ProfileHeader',
    slug: 'profile-header',
    states: Object.keys(profileHeaderFixtures.STATES),
  },
  { id: 'C-CardShell', slug: 'card-shell', states: Object.keys(cardShellFixtures.STATES) },
  { id: 'C-ActionRow', slug: 'action-row', states: Object.keys(actionRowFixtures.STATES) },
  { id: 'C-FollowButton', slug: 'follow-button', states: Object.keys(followButtonFixtures.STATES) },
  { id: 'C-OfficeCard', slug: 'office-card', states: Object.keys(officeCardFixtures.STATES) },
  { id: 'MiniMapStill', slug: 'mini-map-still', states: Object.keys(miniMapStillFixtures.STATES) },
];

/** The civic components, in the order of the design system, and the still of the mini map after them. */
const CIVIC_SLUGS = [
  'address-field',
  'person-row',
  'fact-row',
  'table',
  'tag',
  'flag',
  'confidence-badge',
  'source-link',
  'sources-sheet',
  'photo-credit',
  'big-number',
  'deal-line',
  'meter',
  'meter-inputs',
  'deadline-ring',
  'deadline-block',
  'deadline-line',
  'office-tile',
  'profile-header',
  'card-shell',
  'action-row',
  'follow-button',
  'office-card',
  'mini-map-still',
] as const;

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

// An avatar takes the image library in when its first photo is drawn. The gallery is drawn once
// here before any case, so every case after it draws its photos at once.
beforeAll(async () => {
  renderWithProviders(<GalleryScreen {...DEFAULTS} only="avatar" />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  cleanup();
});

// A case that draws the whole gallery and presses a control redraws every component; on a hosted
// runner that takes about five seconds, the default limit.
describe('GalleryScreen', { timeout: 20_000 }, () => {
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
      'C-Popover',
      'C-Tooltip',
      'C-Toast',
      'C-FormField',
      'C-TextField',
      'C-AddressField',
      'C-HandleField',
      'C-CodeField',
      'C-Select',
      'C-Checkbox',
      'C-Radio',
      'C-RadioGroup',
      'C-Switch',
      'C-AgeGate',
      'C-Progress',
      'C-StickyFooter',
      'C-SectionHeader',
      'C-ListRow',
      'C-PersonRow',
      'C-FactRow',
      'C-Table',
      'C-Tag',
      'C-Flag',
      'C-ConfidenceBadge',
      'C-SourceLink',
      'C-SourcesSheet',
      'C-Prose',
      'C-PhotoCredit',
      'C-BigNumber',
      'C-DealLine',
      'C-Meter',
      'C-MeterInputs',
      'C-DeadlineRing',
      'C-DeadlineBlock',
      'C-DeadlineLine',
      'C-IssueTile',
      'C-IssueChip',
      'C-IssueGrid',
      'C-OfficeTile',
      'C-ProfileHeader',
      'C-CardShell',
      'C-ActionRow',
      'C-FollowButton',
      'C-OfficeCard',
      'MiniMapStill',
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
    // One cell for each state of each fixtures file, under the state's own name. The cells are
    // read once into a map: a query of the whole gallery per state is slow on a hosted runner.
    const byId = new Map(cells().map((cell) => [cell.getAttribute('data-testid'), cell]));
    for (const component of COMPONENTS) {
      for (const state of component.states) {
        const id = `gallery.cell-${component.slug}-${kebab(state)}`;
        const cell = byId.get(id);
        expect(cell, id).toBeDefined();
        expect(cell?.firstElementChild?.textContent, `${component.id} ${state}`).toBe(state);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('every civic component has its section', () => {
    expect(CIVIC_SLUGS).toHaveLength(24);
    // Each has exactly one section, and the 24 stand in this order among the others.
    const slugs = COMPONENTS.map((component) => component.slug);
    for (const slug of CIVIC_SLUGS) {
      expect(
        slugs.filter((name) => name === slug),
        slug,
      ).toHaveLength(1);
    }
    expect(slugs.filter((slug) => (CIVIC_SLUGS as readonly string[]).includes(slug))).toEqual([
      ...CIVIC_SLUGS,
    ]);
    // Drawn alone, each shows its heading and a cell for every state of its fixtures.
    for (const slug of CIVIC_SLUGS) {
      const component = COMPONENTS.find((entry) => entry.slug === slug);
      draw({ only: slug });
      expect(sectionHeadings(), slug).toEqual([component?.id]);
      expect(
        cells().map((cell) => cell.getAttribute('data-testid')),
        slug,
      ).toEqual((component?.states ?? []).map((state) => `gallery.cell-${slug}-${kebab(state)}`));
    }
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

  it('the right column stands at the start of its cell, where the narrowest window holds it', () => {
    draw({ only: 'right-column' });
    const box = boxOf('gallery.cell-right-column-two-modules');
    const column = [...box.querySelectorAll<HTMLElement>('*')].find(
      (element) => element.style.width === `${String(size.rightColumn)}px`,
    );
    expect(column).toBeDefined();
    // The column brings the gap that parts it from a main column, and a specimen has none beside
    // it: from the box's edge in, the room and the margins on the way come to nothing.
    let start = Number.parseFloat(box.style.paddingLeft);
    for (let element = column; element !== undefined && element !== box;) {
      start += Number.parseFloat(element.style.marginLeft || '0');
      element = element.parentElement ?? undefined;
    }
    expect(start).toBe(0);
    // So the whole column stands between the gutters of a window 360 wide.
    expect(size.rightColumn).toBeLessThanOrEqual(360 - 2 * gutter.narrow);
    expect(within(box).getByText('Deadlines near you')).toBeDefined();
  });

  it('draws the longest text of a full screen in a frame as high as the smallest phone', () => {
    draw({ only: 'system-screen' });
    const frame = size.listRowMin * 8;
    for (const state of ['blocking', 'noAction', 'withSecondary']) {
      expect(boxOf(`gallery.cell-system-screen-${kebab(state)}`).style.height, state).toBe(
        `${String(frame)}px`,
      );
    }
    // At 360 wide with text at 130% the long text takes more than the short frame holds, and a
    // window never gives it less than the smallest phone does.
    const tall = Number.parseFloat(boxOf('gallery.cell-system-screen-long-text').style.height);
    expect(tall).toBe(size.listRowMin * 13);
    expect(tall).toBeLessThanOrEqual(740);
    expect(tall).toBeGreaterThan(740 - size.listRowMin);
  });

  it('the tile strip holds every issue, each named', () => {
    draw({ only: 'issue-tile', initialTheme: 'light' });
    const strip = boxOf('gallery.cell-issue-tile-every-issue');
    const tiles = within(strip).getAllByRole('img');
    expect(tiles).toHaveLength(ISSUE_IDS.length);
    // Each tile in its issue's color, in the order of the issues, and no two named alike.
    expect(tiles.map((tile) => tile.style.backgroundColor)).toEqual(
      ISSUE_IDS.map((id) => written(issue[id].light)),
    );
    const names = tiles.map((tile) => tile.getAttribute('aria-label') ?? '');
    expect(new Set(names).size).toBe(ISSUE_IDS.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
    // The keylined tile stands on the ground its keyline is for.
    expect(boxOf('gallery.cell-issue-tile-keyline').style.backgroundColor).toBe(written('#E3E0D5'));
  });

  it('the issue grid stands in a phone frame, and once in the column of a wide window', () => {
    const frameOf = (testID: string): HTMLElement => {
      const frame = screen.getByTestId(testID).parentElement;
      if (frame === null) {
        throw new Error(`the grid ${testID} has no frame`);
      }
      return frame;
    };
    // The window this file's other cases are drawn in, put back when this one ends.
    const root = document.documentElement;
    const before = [
      [root, 'clientWidth', root.clientWidth],
      [root, 'clientHeight', root.clientHeight],
      [window, 'innerWidth', window.innerWidth],
      [window, 'innerHeight', window.innerHeight],
    ] as const;
    try {
      setViewport(1440, 900);
      draw({ only: 'issue-grid' });
      // A window 390 points wide, with its gutters, inside a hairline.
      for (const state of ['none', 'three', 'ten']) {
        const frame = frameOf(`gallery.issue-grid-${state}`);
        expect(frame.style.width, state).toBe('392px');
        expect(frame.style.paddingLeft, state).toBe(`${String(gutter.regular)}px`);
        expect(frame.style.paddingRight, state).toBe(`${String(gutter.regular)}px`);
        expect(frame.style.borderWidth, state).toBe('1px');
      }
      // The same three picks in a column 600 points wide.
      const column = frameOf('gallery.issue-grid-three-in-column');
      expect(column.style.width).toBe(`${String(size.feedColumn + 2)}px`);
      expect(size.feedColumn).toBe(600);
      const picked = (testID: string): string[] =>
        within(screen.getByTestId(testID))
          .getAllByRole('checkbox', { checked: true })
          .map((chip) => chip.getAttribute('aria-label') ?? '');
      expect(picked('gallery.issue-grid-three-in-column')).toEqual(
        picked('gallery.issue-grid-three'),
      );

      // On a phone the window itself is the frame: the grid is as wide as the page between its
      // gutters, with no outline round it.
      setViewport(360, 740);
      draw({ only: 'issue-grid' });
      for (const state of ['none', 'three', 'ten', 'three-in-column']) {
        const frame = frameOf(`gallery.issue-grid-${state}`);
        expect(frame.style.width, state).toBe(`${String(360 - gutter.narrow * 2)}px`);
        expect(frame.style.borderWidth, state).toBe('');
        expect(frame.style.paddingLeft, state).toBe('');
      }
    } finally {
      for (const [target, name, value] of before) {
        Object.defineProperty(target, name, { configurable: true, value });
      }
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
    }
  });

  it('a pick and a star in the issue grid are the specimen’s own, and a limit is said', () => {
    draw({ only: 'issue-grid' });
    const cell = screen.getByTestId('gallery.cell-issue-grid-three');
    expect(within(cell).getByText('3 picked, 1 starred')).toBeDefined();
    press('gallery.issue-grid-three-climate');
    expect(within(cell).getByText('4 picked, 1 starred')).toBeDefined();
    expect(
      screen.getByTestId('gallery.issue-grid-three-climate').getAttribute('aria-checked'),
    ).toBe('true');
    press('gallery.issue-grid-three-climate-star');
    expect(within(cell).getByText('4 picked, 2 starred')).toBeDefined();
    // An issue that is no longer picked keeps no star.
    press('gallery.issue-grid-three-climate');
    expect(within(cell).getByText('3 picked, 1 starred')).toBeDefined();
    // The other specimens keep their own picks.
    expect(
      within(screen.getByTestId('gallery.cell-issue-grid-none')).getByText('0 picked, 0 starred'),
    ).toBeDefined();
    // Past a limit nothing changes, and the line says which limit was met.
    const full = screen.getByTestId('gallery.cell-issue-grid-ten');
    press('gallery.issue-grid-ten-schools');
    expect(within(full).getByText('10 picked, 3 starred. 10 is the most.')).toBeDefined();
    press('gallery.issue-grid-ten-utility-bills-star');
    expect(within(full).getByText('10 picked, 3 starred. 3 is the most.')).toBeDefined();
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

  it('a toast raised from the gallery follows the gallery’s theme and text size', () => {
    cleanup();
    // The app around the gallery is light, at 100% text.
    renderWithProviders(
      <ToastHost>
        <GalleryScreen {...DEFAULTS} only="toast" initialTheme="dark" initialTextScale={1.3} />
      </ToastHost>,
    );
    press('gallery.show-toast-success');
    const toast = screen.getByTestId('toast');
    const words = within(toast).getByText(toastFixtures.STATES.success.text);
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(toast.style.backgroundColor).toBe(written('#F3F1EA'));
    expect(words.style.fontSize).toBe('18.2px');

    // The gallery's controls reach the toast that is showing.
    press('gallery.text-100');
    expect(
      within(screen.getByTestId('toast')).getByText(toastFixtures.STATES.success.text).style
        .fontSize,
    ).toBe('14px');
    press('gallery.theme-light');
    expect(screen.getByTestId('toast').style.backgroundColor).toBe(written('#141412'));
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
