import { cleanup, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { Button } from './button';
import { InteractionPreview } from './pressable';
import { ProfileHeader } from './profile-header';
import type { ProfileHeaderProps } from './profile-header';
import { GROUND, PREVIEW, STATES } from './profile-header.fixtures';

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

// The image library does not load in this environment. This stands in for its view; C-Avatar's own
// test covers the photo.
vi.mock('expo-image', () => ({
  Image: (): ReactElement => createElement('div'),
}));

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'person',
  'personWithPhoto',
  'unclaimed',
  'withTag',
  'longName',
  'withActions',
  'blocked',
] as const;

const ALL: Readonly<Record<StateName, ProfileHeaderProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const BIO = 'Bus rider and renter. Running so the council meets when working people can come.';
const CREDIT = 'Fixture Photographer, CC BY 4.0, cropped';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)', 'scale(1) rotate(0deg)'];

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one header, in place of whatever was drawn before, and gives back its root. */
function draw(
  props: ProfileHeaderProps,
  options: RenderWithProvidersOptions = {},
  pressed = false,
): HTMLElement {
  cleanup();
  const header = <ProfileHeader {...props} />;
  renderWithProviders(
    pressed ? <InteractionPreview state={{ pressed: true }}>{header}</InteractionPreview> : header,
    options,
  );
  return screen.getByTestId(props.testID);
}

/** The round avatar of a header. */
function avatarOf(header: HTMLElement): HTMLElement {
  const avatar = header.querySelector<HTMLElement>('[style*="border-radius: 9999px"]');
  if (avatar === null) {
    throw new Error('the header draws no avatar');
  }
  return avatar;
}

/** True when `first` is drawn before `second`. */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('ProfileHeader', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const fixture = ALL[state];
          const header = draw(fixture, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // The round avatar of 80, then the words 16 from it.
          const avatar = avatarOf(header);
          expect(avatar.style.width, name).toBe(`${String(size.avatar.xl)}px`);
          expect(avatar.style.height, name).toBe(`${String(size.avatar.xl)}px`);
          const row = header.firstElementChild;
          expect(row instanceof HTMLElement ? row.style.columnGap : '', name).toBe(
            `${String(space.x4)}px`,
          );
          // The name in the heading role, at full contrast, wrapping as far as it needs.
          const title = within(header).getByRole('heading');
          expect(title.textContent, name).toBe(fixture.name);
          expect(title.style.fontFamily, name).toBe(typography.heading.style.fontFamily);
          expect(parseFloat(title.style.fontSize), name).toBeCloseTo(
            (typography.heading.style.fontSize ?? 0) * scale,
          );
          expect(title.style.color, name).toBe(written(color[theme].text));
          expect(window.getComputedStyle(title).webkitLineClamp, name).not.toBe('1');
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.person).toMatchObject({
      image: null,
      name: 'Carol Wynn',
      handle: null,
      tag: null,
      lines: ['County Treasurer · Fixture Wren County, ZZ'],
      bio: null,
      link: null,
      photoCredit: null,
      stats: [],
      actions: [],
      notice: null,
    });
    expect(STATES.personWithPhoto.image).not.toBeNull();
    expect(STATES.personWithPhoto.photoCredit).toBe(CREDIT);
    expect(STATES.unclaimed.lines).toContain('Created from public filings');
    expect(STATES.unclaimed.handle).toBeNull();
    expect(STATES.withTag.tag).not.toBeNull();
    expect(STATES.longName.name).toBe('Fixture Maria Guadalupe Hernandez Castellanos de la Fuente');
    expect(STATES.withActions.actions).toHaveLength(1);
    expect(STATES.blocked.notice).toBe('You blocked this account.');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const header = draw(fixture);
      // One heading, the name: the page's first where the app bar shows the handle instead.
      const headings = within(header).getAllByRole('heading');
      expect(headings, state).toHaveLength(1);
      expect(headings[0]?.textContent, state).toBe(fixture.name);
      expect(headings[0]?.getAttribute('aria-level'), state).toBe(
        fixture.handle === null ? '2' : '1',
      );
      // The avatar adds nothing: the name is printed beside it.
      expect(header.querySelectorAll('[role="img"]'), state).toHaveLength(0);
      expect(avatarOf(header).closest('[aria-hidden="true"]'), state).not.toBeNull();
    }
    // The link is named by its domain, and says it leaves the app.
    const withLink = draw(STATES.withActions);
    const link = within(withLink).getByRole('link');
    expect(link.getAttribute('aria-label')).toContain('okafor.example');
    expect(link.getAttribute('href')).toBe('https://okafor.example/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toBe('okafor.example');
    // An action keeps the name it came with.
    expect(within(withLink).getByRole('button', { name: 'Follow Dana Okafor' })).toBeDefined();
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const header = draw(fixture);
      expect(fixture.testID, state).toMatch(TEST_ID);
      expect(fixture.testID, state).toMatch(/^gallery\.profile-header-/);
      expect(header.getAttribute('data-testid'), state).toBe(fixture.testID);
      // Everything a person can press carries an id.
      for (const element of document.querySelectorAll('[role="button"], [role="link"], a')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
    // The link's id follows the header's.
    const header = draw(STATES.withActions);
    expect(within(header).getByRole('link').getAttribute('data-testid')).toBe(
      'gallery.profile-header-with-actions-link',
    );
  });

  it('respects reduced motion', () => {
    // A header never moves; under reduced motion nothing in it does, pressed or not.
    for (const state of STATE_NAMES) {
      const header = draw(ALL[state], { reducedMotion: true }, true);
      for (const part of [header, ...header.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
      }
    }
  });

  it('the people form', () => {
    const header = draw(STATES.person);
    // The avatar, the name as a level 2 heading and the line: the app bar holds the name.
    expect(avatarOf(header).textContent).toBe('CW');
    const name = within(header).getByRole('heading', { level: 2, name: 'Carol Wynn' });
    const line = within(header).getByText('County Treasurer · Fixture Wren County, ZZ');
    expect(line.style.fontFamily).toBe(typography.caption.style.fontFamily);
    expect(line.style.color).toBe(written(color.light.textSecondary));
    expect(precedes(avatarOf(header), name)).toBe(true);
    expect(precedes(name, line)).toBe(true);
    // No handle, no stats row, nothing to press.
    expect(header.querySelector('[style*="ChivoMono"]')).toBeNull();
    expect(header.querySelectorAll('[role="button"], [role="link"], a')).toHaveLength(0);
    expect(header.children).toHaveLength(1);

    // The stats are not drawn yet, whatever a caller passes.
    const counted = draw({
      ...STATES.person,
      stats: [{ id: 'followers', text: '31 followers', href: '/dev/gallery' }],
    });
    expect(within(counted).queryByText('31 followers')).toBeNull();
    expect(counted.querySelectorAll('a')).toHaveLength(0);

    // An account: the handle in mono under the name, the bio at full contrast, then the action
    // under the row.
    const account = draw(STATES.withActions);
    const handle = within(account).getByText('dana_okafor');
    expect(handle.style.fontFamily).toContain('ChivoMono');
    expect(handle.style.color).toBe(written(color.light.textSecondary));
    expect(precedes(within(account).getByRole('heading', { level: 1 }), handle)).toBe(true);
    const bio = within(account).getByText(BIO);
    expect(bio.style.fontFamily).toBe(typography.caption.style.fontFamily);
    expect(bio.style.color).toBe(written(color.light.text));
    expect(precedes(bio, within(account).getByRole('link'))).toBe(true);
    const actions = account.children[1];
    expect(account.children).toHaveLength(2);
    expect(actions instanceof HTMLElement ? actions.style.marginTop : '').toBe(
      `${String(space.x3)}px`,
    );
    expect(actions instanceof HTMLElement ? actions.style.flexWrap : '').toBe('wrap');
    expect(actions instanceof HTMLElement ? actions.style.columnGap : '').toBe(
      `${String(space.x2)}px`,
    );
    expect(actions?.contains(within(account).getByRole('button'))).toBe(true);

    // A tag stands beside the name, on the name's line while there is room.
    const tagged = draw(STATES.withTag);
    const tag = within(tagged).getByText('Independent');
    const heading = within(tagged).getByRole('heading');
    expect(precedes(heading, tag)).toBe(true);
    expect(heading.parentElement?.parentElement?.contains(tag)).toBe(true);
    expect(heading.parentElement?.parentElement?.style.flexWrap).toBe('wrap');
    expect(heading.parentElement?.parentElement?.style.columnGap).toBe(`${String(space.x2)}px`);
  });

  it('credit under the photo', () => {
    const header = draw(STATES.personWithPhoto);
    const avatar = avatarOf(header);
    const credit = within(header).getByText(CREDIT);
    // In mono, after the avatar, in the avatar's own column: under the photo, never over it.
    expect(credit.style.fontFamily).toContain('ChivoMono');
    expect(precedes(avatar, credit)).toBe(true);
    const column = credit.closest<HTMLElement>(`[style*="width: ${String(size.avatar.xl)}px"]`);
    expect(column?.contains(avatar)).toBe(true);
    expect(avatar.contains(credit)).toBe(false);
    expect(column?.contains(within(header).getByRole('heading'))).toBe(false);
    // No credit, no line for one.
    expect(within(draw(STATES.person)).queryByText(CREDIT)).toBeNull();
  });

  it('blocked replaces the rest', () => {
    const header = draw({ ...STATES.blocked, photoCredit: CREDIT });
    // The name, the handle and the sentence, in body.
    expect(within(header).getByRole('heading', { level: 1, name: 'Dana Okafor' })).toBeDefined();
    expect(within(header).getByText('dana_okafor')).toBeDefined();
    const notice = within(header).getByText('You blocked this account.');
    expect(notice.style.fontFamily).toBe(typography.body.style.fontFamily);
    expect(parseFloat(notice.style.fontSize)).toBe(typography.body.style.fontSize);
    // No line, bio, link or photo credit, and no action.
    expect(within(header).queryByText('Running for Fixture Alder City Council')).toBeNull();
    expect(within(header).queryByText(BIO)).toBeNull();
    expect(within(header).queryByText('okafor.example')).toBeNull();
    expect(within(header).queryByText(CREDIT)).toBeNull();
    expect(header.querySelectorAll('[role="button"], [role="link"], a')).toHaveLength(0);
    expect(header.children).toHaveLength(1);

    // The one way back stays: an action a screen passes is still drawn under the sentence (C-ProfileHeader).
    const withWayBack = draw({
      ...STATES.blocked,
      actions: [
        <Button
          key="unblock"
          variant="secondary"
          label="Unblock"
          onPress={() => undefined}
          testID="probe.unblock"
        />,
      ],
    });
    const unblock = within(withWayBack).getByRole('button', { name: 'Unblock' });
    expect(precedes(within(withWayBack).getByText('You blocked this account.'), unblock)).toBe(
      true,
    );
    expect(within(withWayBack).queryByText(BIO)).toBeNull();
  });
});
