import { cleanup, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { size } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { PersonRow } from './person-row';
import type { PersonRowProps } from './person-row';
import { GROUND, PREVIEW, STATES } from './person-row.fixtures';
import { InteractionPreview } from './pressable';

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
  'holder',
  'withAction',
  'tagAndAction',
  'noPhoto',
  'notALink',
  'handleOnly',
  'longName',
] as const;

const ALL: Readonly<Record<StateName, PersonRowProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const CHEVRON_RIGHT = 'M9 5l7 7-7 7';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)', 'scale(1) rotate(0deg)'];

/** Renders one row, in place of whatever was drawn before, and gives back the element with its id. */
function draw(
  props: PersonRowProps,
  options: RenderWithProvidersOptions = {},
  pressed = false,
): HTMLElement {
  cleanup();
  const row = <PersonRow {...props} />;
  renderWithProviders(
    pressed ? <InteractionPreview state={{ pressed: true }}>{row}</InteractionPreview> : row,
    options,
  );
  return screen.getByTestId(props.testID);
}

/**
 * The whole row: the line that holds its minimum height. It is inside a row that is one link, and
 * around the link of a row that carries an action beside it.
 */
function frameOf(row: HTMLElement): HTMLElement {
  const frame = [row.parentElement?.parentElement, row, ...row.querySelectorAll<HTMLElement>('*')]
    .filter((part) => part !== null && part !== undefined)
    .find((part) => part.style.minHeight === `${String(size.listRowMin)}px`);
  if (frame === undefined) {
    throw new Error('the row draws no frame');
  }
  return frame;
}

/** True when `first` is drawn before `second`. */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The chevrons drawn in a row. */
function chevrons(frame: HTMLElement): Element[] {
  return [...frame.querySelectorAll('path')].filter(
    (path) => path.getAttribute('d') === CHEVRON_RIGHT,
  );
}

describe('PersonRow', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const fixture = ALL[state];
          const frame = frameOf(draw(fixture, { theme, textScale: scale }));
          const name = `${state} ${theme} ${String(scale)}`;
          // A regular row: at least 56 points, whatever it carries.
          expect(frame.style.minHeight, name).toBe('56px');
          // The name, or the handle alone, in the label face.
          const title = within(frame).getAllByText(fixture.name ?? fixture.handle ?? '')[0];
          expect(title?.style.fontFamily, name).toBe(typography.label.style.fontFamily);
          expect(parseFloat(title?.style.fontSize ?? ''), name).toBeCloseTo(
            (typography.label.style.fontSize ?? 0) * scale,
          );
          // A round avatar of 36 leads.
          const avatar = frame.querySelector<HTMLElement>('[style*="border-radius: 9999px"]');
          expect(avatar?.style.width, name).toBe(`${String(size.avatar.sm)}px`);
          expect(avatar?.style.height, name).toBe(`${String(size.avatar.sm)}px`);
          if (fixture.line !== null) {
            const line = within(frame).getByText(fixture.line);
            expect(line.style.fontFamily, name).toBe(typography.caption.style.fontFamily);
          }
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
    expect(STATES.holder).toMatchObject({
      name: 'Carol Wynn',
      handle: null,
      line: 'Holder since 2019',
      tag: { label: 'Independent', variant: 'outline' },
      action: null,
    });
    expect(STATES.withAction).toMatchObject({ name: 'Dana Okafor', handle: 'dana_okafor' });
    expect(STATES.withAction.tag).toBeNull();
    expect(STATES.withAction.action).not.toBeNull();
    expect(STATES.tagAndAction.tag).not.toBeNull();
    expect(STATES.tagAndAction.action).not.toBeNull();
    expect(STATES.noPhoto.image).toBeNull();
    expect(STATES.notALink.href).toBeNull();
    expect(STATES.handleOnly).toMatchObject({ name: null, handle: 'dana_okafor', line: null });
    expect(STATES.longName.name).toBe('Fixture Maria Guadalupe Hernandez Castellanos de la Fuente');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const row = draw(fixture);
      if (fixture.href === null) {
        expect(row.getAttribute('role'), state).toBeNull();
        expect(screen.queryAllByRole('link'), state).toHaveLength(0);
        continue;
      }
      // A link to the person's page, named by the name or the handle.
      expect(row.tagName, state).toBe('A');
      expect(row.getAttribute('role'), state).toBe('link');
      expect(row.getAttribute('href'), state).toBe(fixture.href);
      expect(row.getAttribute('aria-label'), state).toContain(fixture.name ?? fixture.handle ?? '');
      // The avatar adds nothing: the name is printed beside it.
      expect(row.querySelectorAll('[role="img"]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const row = draw(fixture);
      expect(fixture.testID, state).toMatch(TEST_ID);
      expect(fixture.testID, state).toMatch(/^gallery\.person-row-/);
      expect(row.getAttribute('data-testid'), state).toBe(fixture.testID);
      // Everything a person can press carries an id.
      for (const element of document.querySelectorAll('[role="button"], [role="link"], a')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    // A row cuts to its fill and never moves; under reduced motion nothing in it does.
    for (const state of STATE_NAMES) {
      const frame = frameOf(draw(ALL[state], { reducedMotion: true }, true));
      for (const part of [frame, ...frame.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
      }
    }
  });

  it('name and handle', () => {
    const named = frameOf(draw(STATES.withAction));
    const title = within(named).getByText('Dana Okafor');
    const handle = within(named).getByText('dana_okafor');
    expect(title.style.fontFamily).toBe(typography.label.style.fontFamily);
    // The handle in mono, after the name on its line, and the first of the two to be cut short.
    expect(handle.style.fontFamily).toContain('ChivoMono');
    expect(precedes(title, handle)).toBe(true);
    expect(window.getComputedStyle(handle).whiteSpace).toBe('nowrap');
    expect(window.getComputedStyle(handle).textOverflow).toBe('ellipsis');
    expect(handle.parentElement?.style.flexBasis).toBe('0%');
    expect(handle.parentElement?.parentElement).toBe(title.parentElement?.parentElement);

    // With no name the handle alone is the title, drawn once and in the label face.
    const alone = frameOf(draw(STATES.handleOnly));
    const only = within(alone).getAllByText('dana_okafor');
    expect(only).toHaveLength(1);
    expect(only[0]?.style.fontFamily).toBe(typography.label.style.fontFamily);
    expect(draw(STATES.handleOnly).getAttribute('aria-label')).toBe('dana_okafor');

    // A person from public records has a name and no handle.
    const holder = frameOf(draw(STATES.holder));
    expect(holder.querySelector('[style*="flex-basis: 0%"]')).toBeNull();
  });

  it('trailing order', () => {
    // A tag and no action: the tag at the right, after the words, and no chevron.
    const holder = frameOf(draw(STATES.holder));
    const party = within(holder).getByText('Independent');
    expect(precedes(within(holder).getByText('Carol Wynn'), party)).toBe(true);
    expect(precedes(within(holder).getByText('Holder since 2019'), party)).toBe(true);
    expect(chevrons(holder)).toHaveLength(0);

    // An action: the action at the right, beside the link and not inside it.
    const link = draw(STATES.withAction);
    const withAction = frameOf(link);
    const follow = within(withAction).getByTestId('gallery.person-row-with-action-follow');
    expect(link.contains(follow)).toBe(false);
    expect(precedes(link, follow)).toBe(true);
    expect(chevrons(withAction)).toHaveLength(0);

    // Both: the action keeps the right, and the tag moves in front of the line.
    const bothLink = draw(STATES.tagAndAction);
    const both = frameOf(bothLink);
    const filed = within(both).getByText('Filed');
    const line = within(both).getByText('Filed Thu, Nov 12');
    expect(precedes(within(both).getByText('Luis Marrero'), filed)).toBe(true);
    expect(precedes(filed, line)).toBe(true);
    expect(bothLink.contains(filed)).toBe(true);
    const action = within(both).getByTestId('gallery.person-row-tag-and-action-follow');
    expect(bothLink.contains(action)).toBe(false);
    expect(precedes(line, action)).toBe(true);
    expect(chevrons(both)).toHaveLength(0);

    // A link with neither: a chevron.
    expect(chevrons(frameOf(draw(STATES.handleOnly)))).toHaveLength(1);
    // Neither, and no link: nothing at the right.
    const plain = frameOf(draw(STATES.notALink));
    expect(chevrons(plain)).toHaveLength(0);
    expect(plain.querySelectorAll('svg')).toHaveLength(0);
  });

  it('not a link', () => {
    const row = draw(STATES.notALink);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('a, [tabindex]')).toHaveLength(0);
    expect(row.getAttribute('aria-label')).toBeNull();
    // The words are read as they are drawn.
    expect(within(row).getByText('Tasha Whitfield')).toBeDefined();
    expect(within(row).getByText('Director, Fixture Wren County Water Board')).toBeDefined();
  });

  it('the name is read with its line and tag', () => {
    const row = draw(STATES.holder);
    // The link's name holds the person's name and the line.
    const said = row.getAttribute('aria-label') ?? '';
    expect(said).toContain('Carol Wynn');
    expect(said).toContain('Holder since 2019');
    expect(screen.getByRole('link', { name: 'Carol Wynn. Holder since 2019' })).toBe(row);
    // The tag's word is in the row, as text and in sentence case, and hidden from nobody.
    const tag = within(row).getByText('Independent');
    expect(tag.closest('[aria-hidden="true"]')).toBeNull();
    expect(row.textContent).toContain('Carol Wynn');
    expect(row.textContent).toContain('Holder since 2019');
    expect(row.textContent).toContain('Independent');

    // A row that is no link is read as it is drawn: the name, the line and the tag.
    const plain = draw({ ...STATES.holder, href: null });
    expect(plain.getAttribute('aria-label')).toBeNull();
    expect(plain.textContent).toContain('Carol Wynn');
    expect(plain.textContent).toContain('Holder since 2019');
    expect(plain.textContent).toContain('Independent');
  });
});
