import { runAgainstAltText } from '@citizenrun/cards';
import type { TFunction } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getI18n } from '@/lib/i18n';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { clearOncePerItem } from '@/ui/motion';
import { color, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { FIXTURE_ALT_TEXT, FIXTURE_NOW, fixtureOffice } from './__fixtures__/fixture-canvas';
import { OfficeCard } from './office-card';
import type { OfficeCardProps } from './office-card';
import { GROUND, PREVIEW, STATES } from './office-card.fixtures';

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

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'known',
  'unknown',
  'about',
  'noMatch',
  'approximate',
  'following',
  'withMeters',
] as const;

const ALL: Readonly<Record<StateName, OfficeCardProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const UNKNOWN = 'not known yet';
const OFFICE_PAGE = '/office/fixture-county-treasurer';
const REASON = 'In your county';
const MATCH = 'Matches Property taxes';
const CLOSING = 'Filing closes Fri, Nov 27. Confirm with your election office.';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one card, in place of whatever was drawn before, and gives back its root. */
function draw(props: OfficeCardProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<OfficeCard {...props} />, options);
  return screen.getByTestId(props.testID);
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

/** True when `first` comes before `second` in the page. */
function before(first: HTMLElement, second: HTMLElement): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(() => {
  clearOncePerItem();
});

describe('OfficeCard', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const card = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // The reason, the canvas, the action row and the three rows every card has.
          const reason = within(headerOf(card)).getByText(props.header.reason);
          expect(reason.style.color, name).toBe(written(color[theme].text));
          expect(
            screen.getByTestId(`${props.testID}-box`).querySelector('svg'),
            name,
          ).not.toBeNull();
          expect(screen.getByTestId(props.actions.testID), name).toBeTruthy();
          const closing = within(screen.getByTestId(`${props.testID}-closing`)).getByText(
            props.closingLine,
          );
          expect(parseFloat(closing.style.fontSize), name).toBeCloseTo(
            (typography.label.style.fontSize ?? 0) * scale,
          );
          expect(closing.style.color, name).toBe(written(color[theme].text));
          expect(screen.getByTestId(`${props.testID}-source`), name).toBeTruthy();
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the canvas draws its text without pair kerning', () => {
    const props = ALL.known;
    draw(props);
    const lines = [
      ...screen.getByTestId(`${props.testID}-box`).querySelectorAll<SVGTextElement>('svg text'),
    ];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // The browser reads the style; the attribute is what the server's renderer reads.
      expect(line.style.getPropertyValue('font-kerning'), line.textContent).toBe('none');
      expect(line.getAttribute('kerning'), line.textContent).toBe('0');
    }
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.office-card-${kebab(state)}`);
      expect(ALL[state].actions.testID, state).toBe(`gallery.office-card-${kebab(state)}-actions`);
      expect(ALL[state].actions.run, state).toEqual({ state: 'hidden' });
      expect(ALL[state].href, state).toBe(OFFICE_PAGE);
    }
    expect(STATES.known).toMatchObject({
      header: { illustration: 'county-treasurer', reason: REASON, match: MATCH },
      altText: FIXTURE_ALT_TEXT.known,
      ease: null,
      impact: null,
      closingLine: CLOSING,
      costLine: '$50 to file.',
      source: { confidence: 'medium', text: 'wrencounty.example. Checked Mon, Nov 9.' },
    });
    expect(STATES.unknown).toMatchObject({
      altText: FIXTURE_ALT_TEXT.allUnknown,
      closingLine: 'Filing deadline not known yet. Confirm with your election office.',
      costLine: null,
      source: { confidence: 'low', text: 'Low confidence · Sources' },
    });
    expect(STATES.about.source).toMatchObject({ confidence: 'low' });
    expect(STATES.about.altText).toBe(FIXTURE_ALT_TEXT.known);
    expect(STATES.noMatch.header.match).toBeNull();
    expect(STATES.approximate.header.match).toBe('May include you. Check your district.');
    expect(STATES.following.actions).toMatchObject({ following: true, bookmarked: true });
    expect(STATES.withMeters.ease).toMatchObject({ score: 72, phrase: 'Easier than most' });
    expect(STATES.withMeters.impact).toMatchObject({
      score: 45,
      phrase: 'Medium on Property taxes',
    });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const card = draw(props);
      expect(card.getAttribute('role'), state).toBe('group');
      // The box is the one link, named by the alt text of its canvas.
      const box = screen.getByRole('link', { name: props.altText });
      expect(screen.getAllByRole('link'), state).toEqual([box]);
      // The menu, Follow, Bookmark and the source row are buttons with names.
      for (const button of screen.getAllByRole('button')) {
        expect(button.getAttribute('aria-label') ?? button.textContent, state).not.toBe('');
      }
      expect(screen.getByRole('button', { name: 'More actions' }), state).toBeTruthy();
    }
    draw(STATES.known);
    expect(
      screen.getByRole('button', {
        name: 'Medium confidence. wrencounty.example. Checked Mon, Nov 9.',
      }),
    ).toBe(screen.getByTestId('gallery.office-card-known-source'));
    const onOpenMenu = vi.fn();
    const onPress = vi.fn();
    draw({ ...STATES.known, onOpenMenu, source: { ...STATES.known.source, onPress } });
    fireEvent.click(screen.getByTestId('gallery.office-card-known-menu'));
    fireEvent.click(screen.getByTestId('gallery.office-card-known-source'));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    // With no menu to open, the header draws no button.
    draw({ ...STATES.known, onOpenMenu: null });
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
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
      expect(ids, state).toContain(props.testID);
      expect(ids, state).toContain(`${props.testID}-box`);
      expect(ids, state).toContain(`${props.testID}-closing`);
      expect(ids, state).toContain(`${props.testID}-source`);
    }
  });

  it('respects reduced motion', () => {
    // The card adds no motion of its own: a press on the box moves nothing (MO-press), and under
    // reduced motion no pip of a meter seen for the first time slides or scales.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
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
        const closing = screen.getByTestId(`${props.testID}-closing`);
        expect(closing.style.transform, state).toBe('');
        expect(closing.style.animationName, state).toBe('');
      }
    }
    clearOncePerItem();
    draw(STATES.withMeters, { reducedMotion: true });
    for (const meter of ['ease', 'impact'] as const) {
      const drawn = screen.getByTestId(`gallery.office-card-with-meters-${meter}`);
      for (const part of drawn.querySelectorAll<HTMLElement>('*')) {
        expect(part.style.transform, meter).toBe('');
      }
    }
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      // Nothing known: the alt text, the canvas and the closing line all say so, at full strength.
      const card = draw(STATES.unknown, { theme });
      const box = screen.getByTestId('gallery.office-card-unknown-box');
      expect(box.getAttribute('aria-label')).toBe(FIXTURE_ALT_TEXT.allUnknown);
      expect(box.getAttribute('aria-label')).toContain(UNKNOWN);
      expect(box.textContent).toContain(UNKNOWN);
      const closing = within(card).getByText(STATES.unknown.closingLine);
      expect(closing.textContent).toContain(UNKNOWN);
      expect(closing.style.color).toBe(written(color[theme].text));
      expect(closing.style.opacity).toBe('');
      // The source row is there, and says how little is known.
      expect(
        screen.getByTestId('gallery.office-card-unknown-source').getAttribute('aria-label'),
      ).toContain('Low confidence');

      // An estimate: the canvas draws the word on the votes, the alt text says it.
      draw(STATES.about, { theme });
      const about = screen.getByTestId('gallery.office-card-about-box');
      expect(about.getAttribute('aria-label')).toContain('About 2,100 votes to win');
      expect(about.textContent).toContain('about');
      expect(about.textContent).not.toContain(UNKNOWN);
      expect(
        within(screen.getByTestId('gallery.office-card-about-source')).getByText(
          'Low confidence · Sources',
        ),
      ).toBeTruthy();
    }
  });

  it('meta rows in order', () => {
    const card = draw(STATES.known);
    const closing = screen.getByTestId('gallery.office-card-known-closing');
    const cost = screen.getByTestId('gallery.office-card-known-cost');
    const source = screen.getByTestId('gallery.office-card-known-source');
    expect(within(closing).getByText(CLOSING)).toBeTruthy();
    expect(cost.textContent).toBe('$50 to file.');
    expect(parseFloat(cost.style.fontSize)).toBe(typography.caption.style.fontSize);
    expect(before(closing, cost)).toBe(true);
    expect(before(cost, source)).toBe(true);
    // The three rows stand in the meta block, under the action row.
    const meta = card.lastElementChild;
    expect(meta?.contains(closing)).toBe(true);
    expect(meta?.contains(cost)).toBe(true);
    expect(meta?.contains(source)).toBe(true);
    expect(before(screen.getByTestId('gallery.office-card-known-actions'), closing)).toBe(true);
    // No meter until both scores exist.
    expect(screen.queryByTestId('gallery.office-card-known-ease')).toBeNull();
    expect(screen.queryByTestId('gallery.office-card-known-impact')).toBeNull();
  });

  it('two meters side by side', () => {
    draw(STATES.withMeters);
    const ease = screen.getByTestId('gallery.office-card-with-meters-ease');
    const impact = screen.getByTestId('gallery.office-card-with-meters-impact');
    expect(ease.getAttribute('aria-label')).toBe('Ease: Easier than most. 7 of 10.');
    expect(impact.getAttribute('aria-label')).toBe('Impact: Medium on Property taxes. 5 of 10.');
    // One row of two equal columns, the feed form in each.
    const row = ease.parentElement?.parentElement;
    expect(row).toBe(impact.parentElement?.parentElement);
    expect(row?.style.flexDirection).toBe('row');
    expect(row?.style.columnGap).toBe(`${String(space.x4)}px`);
    for (const meter of [ease, impact]) {
      expect(meter.parentElement?.style.flexGrow).toBe('1');
      expect(
        [...meter.querySelectorAll<HTMLElement>('*')].some(
          (part) => part.style.height === `${String(size.meterPipFeed)}px`,
        ),
      ).toBe(true);
    }
    expect(before(ease, impact)).toBe(true);
    expect(before(impact, screen.getByTestId('gallery.office-card-with-meters-closing'))).toBe(
      true,
    );
  });

  it('one meter alone throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup();
    expect(() => renderWithProviders(<OfficeCard {...STATES.withMeters} impact={null} />)).toThrow(
      'A meter row needs both meters.',
    );
    expect(() => renderWithProviders(<OfficeCard {...STATES.withMeters} ease={null} />)).toThrow(
      'A meter row needs both meters.',
    );
    errors.mockRestore();
  });

  it('no cost line when null', () => {
    draw(STATES.unknown);
    expect(screen.queryByTestId('gallery.office-card-unknown-cost')).toBeNull();
    expect(screen.getByTestId('gallery.office-card-unknown-source')).toBeTruthy();
    expect(screen.getByTestId('gallery.office-card-unknown-closing')).toBeTruthy();
  });

  it('the header names no office', () => {
    const header = headerOf(draw(STATES.known));
    expect(within(header).getByText(REASON)).toBeTruthy();
    const match = within(header).getByText(MATCH);
    expect(match.style.color).toBe(written(color.light.textSecondary));
    expect(header.textContent).not.toContain('County Treasurer');
    // The leading tile is the office type's glyph, at 36 points.
    expect(
      [...header.querySelectorAll<HTMLElement>('*')].some(
        (part) =>
          part.style.width === `${String(size.officeTile.md)}px` &&
          part.style.height === `${String(size.officeTile.md)}px`,
      ),
    ).toBe(true);
    // With no match the reason stands alone.
    const alone = headerOf(draw(STATES.noMatch));
    expect(alone.textContent).toBe(REASON);
    expect(
      within(headerOf(draw(STATES.approximate))).getByText('May include you. Check your district.'),
    ).toBeTruthy();
  });

  it('the box opens the office page', () => {
    draw(STATES.known);
    const box = screen.getByRole('link', { name: FIXTURE_ALT_TEXT.known });
    expect(box.getAttribute('href')).toBe(OFFICE_PAGE);
    expect(box.getAttribute('data-testid')).toBe('gallery.office-card-known-box');
  });

  it('the action row passes through', () => {
    const onToggleFollow = vi.fn();
    draw({ ...STATES.known, actions: { ...STATES.known.actions, onToggleFollow } });
    const follow = screen.getByTestId('gallery.office-card-known-actions-follow');
    expect(screen.getByTestId('gallery.office-card-known-actions-bookmark')).toBeTruthy();
    // Run is hidden until it exists.
    expect(screen.queryByTestId('gallery.office-card-known-actions-run')).toBeNull();
    fireEvent.click(follow);
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it('the fixture alt text is the builder’s', () => {
    const t = getI18n().getFixedT('en') as unknown as TFunction;
    for (const variant of ['known', 'allUnknown'] as const) {
      const office = fixtureOffice(variant);
      const data = { office, featuredPerson: office.featuredOfficeholder, lastResult: null };
      expect(runAgainstAltText(data, t, { locale: 'en', now: FIXTURE_NOW }), variant).toBe(
        FIXTURE_ALT_TEXT[variant],
      );
    }
  });
});
