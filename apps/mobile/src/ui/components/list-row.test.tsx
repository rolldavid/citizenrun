import { cleanup, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color } from '@/ui/tokens';

import { Button } from './button';
import { IssueTile } from './issue-tile';
import { ListRow } from './list-row';
import type { ListRowProps } from './list-row';
import { GROUND, PREVIEW, STATES } from './list-row.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

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

// The props each native Text receives: the web writes a one-line limit as a class, not as a style.
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

const STATE_NAMES = [
  'chevron',
  'value',
  'count',
  'action',
  'hrefWithAction',
  'avatarLeading',
  'iconLeading',
  'issueLeading',
  'subtitle',
  'longTitle',
  'unread',
  'compact',
  'noDivider',
  'destructive',
  'chevronHovered',
  'chevronPressed',
  'chevronFocused',
] as const;

const ALL: Readonly<Record<StateName, ListRowProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.list-row';
const EDIT = 'probe.list-row-edit';
const CHEVRON = 'M9 5l7 7-7 7';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): HTMLElement {
  cleanup();
  const element = <ListRow {...ALL[state]} />;
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return screen.getByTestId(ALL[state].testID);
}

/** Renders one row under the probe id. */
function draw(given: Partial<ListRowProps> = {}): HTMLElement {
  cleanup();
  renderWithProviders(<ListRow title="Notifications" testID={PROBE} {...given} />);
  return screen.getByTestId(PROBE);
}

/** The frame of a row: the line that holds its minimum height and the rule under it. */
function frameOf(row: HTMLElement): HTMLElement {
  const frame = [row, ...row.querySelectorAll<HTMLElement>('*')]
    .concat(row.parentElement?.parentElement ?? [])
    .find((part) => part.style.paddingTop === '8px' && part.style.minHeight !== '');
  if (frame === undefined) {
    throw new Error('the row draws no frame');
  }
  return frame;
}

/** The small button a row carries as its action. */
function edit(onPress: () => void): NonNullable<ListRowProps['trailing']> {
  return {
    kind: 'action',
    node: <Button variant="secondary" size="sm" label="Edit" testID={EDIT} onPress={onPress} />,
  };
}

describe('ListRow', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const row = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const frame = frameOf(row);
          // At least 56 points, or 44 when compact, with 8 above and below.
          expect(frame.style.minHeight, name).toBe(fixture.size === 'compact' ? '44px' : '56px');
          expect(frame.style.paddingBottom, name).toBe('8px');
          expect(frame.style.alignItems, name).toBe('center');
          // The soft rule under the row, unless the caller takes it away.
          if (fixture.divider === false) {
            expect(frame.style.borderBottomWidth, name).toBe('');
          } else {
            expect(frame.style.borderBottomWidth, name).toBe('1px');
            expect(frame.style.borderBottomColor, name).toBe(written(color[theme].ruleSoft));
          }
          // The title: the label role, in the danger color on a destructive row.
          const title = screen.getByText(fixture.title);
          expect(parseFloat(title.style.fontSize), name).toBeCloseTo(14 * scale);
          expect(title.style.color, name).toBe(
            written(fixture.destructive === true ? color[theme].danger : color[theme].text),
          );
          // A subtitle in words: one caption line in the secondary color.
          if (typeof fixture.subtitle === 'string') {
            const subtitle = screen.getByText(fixture.subtitle);
            expect(parseFloat(subtitle.style.fontSize), name).toBeCloseTo(13 * scale);
            expect(subtitle.style.color, name).toBe(written(color[theme].textSecondary));
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seventeen states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.list-row-${kebab(state)}`);
    }
    expect(PREVIEW).toEqual({
      chevronHovered: { hovered: true },
      chevronPressed: { pressed: true },
      chevronFocused: { focused: true },
    });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const row = drawState(state);
      const fixture = ALL[state];
      const worded =
        typeof fixture.subtitle === 'string'
          ? `${fixture.title}. ${fixture.subtitle}`
          : fixture.title;
      // A setting or a count at the row's end is read with it.
      const said =
        fixture.trailing?.kind === 'value'
          ? `${worded}. ${fixture.trailing.text}`
          : fixture.trailing?.kind === 'count'
            ? `${worded}. ${String(fixture.trailing.value)}`
            : worded;
      if (fixture.href !== undefined) {
        expect(screen.getByRole('link', { name: said }), state).toBe(row);
      } else if (fixture.onPress !== undefined) {
        const name = fixture.unread === true ? `Unread. ${said}` : said;
        expect(screen.getByRole('button', { name }), state).toBe(row);
        expect(screen.getAllByRole('button'), state).toHaveLength(1);
      } else {
        // A row that opens nothing has no role: its words are read as text.
        expect(row.getAttribute('role'), state).toBeNull();
        expect(row.getAttribute('aria-label'), state).toBeNull();
      }
      // The chevron, the dot and a leading icon are decoration.
      for (const icon of row.querySelectorAll('svg')) {
        expect(icon.closest('[aria-hidden="true"]'), state).not.toBeNull();
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const row = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(row.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // Everything a person can press carries an id.
      for (const element of document.querySelectorAll('[role="button"], a, button')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    // A row cuts to its fill and never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        if (ALL[state].trailing?.kind === 'action') {
          continue;
        }
        const row = drawState(state, { reducedMotion }, { pressed: true });
        for (const part of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
        }
      }
    }
  });

  it('a pointer and a press fill the row, and focus rings it', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(drawState('chevronHovered', { theme }).style.backgroundColor, theme).toBe(
        written(color[theme].hoverBg),
      );
      expect(drawState('chevronPressed', { theme }).style.backgroundColor, theme).toBe(
        written(color[theme].pressedBg),
      );
    }
    expect(drawState('chevronFocused').style.outlineStyle).toBe('solid');
    const resting = drawState('chevron');
    expect(resting.style.backgroundColor).toBe('');
    expect(resting.style.outlineStyle).toBe('');
    // The fill is square: a row reaches both edges of its list.
    expect(resting.style.borderRadius).toBe('0px');
  });

  it('the trailing element', () => {
    const chevron = drawState('chevron');
    expect(chevron.querySelector('svg path')?.getAttribute('d')).toBe(CHEVRON);
    expect(chevron.querySelector('svg')?.getAttribute('width')).toBe('20');
    expect(chevron.querySelector('svg path')?.getAttribute('stroke')).toBe(
      color.light.textSecondary,
    );
    drawState('value');
    expect(screen.getByText('System').style.color).toBe(written(color.light.textSecondary));
    drawState('count');
    expect(screen.getByText('128').style.fontVariantNumeric).toBe('tabular-nums');
    // The dot of an unread row: 8 points, round, in the text color, before the trailing element.
    const unread = drawState('unread');
    const dot = [...unread.querySelectorAll<HTMLElement>('*')].find(
      (part) => part.style.width === '8px' && part.style.height === '8px',
    );
    expect(dot?.style.borderRadius).toBe('9999px');
    expect(dot?.style.backgroundColor).toBe(written(color.light.text));
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.nextElementSibling?.querySelector('svg path')?.getAttribute('d')).toBe(CHEVRON);
    expect(dot?.parentElement?.style.columnGap).toBe('8px');
    expect(dot?.parentElement?.style.marginLeft).toBe('12px');
  });

  it('the leading element stands 12 points before the words', () => {
    for (const state of ['avatarLeading', 'iconLeading', 'issueLeading'] as const) {
      const row = drawState(state);
      const title = screen.getByText(ALL[state].title);
      const words = [...row.querySelectorAll<HTMLElement>('*')].find(
        (part) => part.style.minWidth === '0px' && part.contains(title),
      );
      expect(words?.style.flexGrow, state).toBe('1');
      expect(words?.previousElementSibling, state).not.toBeNull();
      expect((words?.previousElementSibling as HTMLElement).style.marginRight, state).toBe('12px');
    }
    // A handle after the name stands on the name's line.
    drawState('avatarLeading');
    const handle = screen.getByText('@carol_wynn');
    expect(handle.parentElement?.style.flexDirection).toBe('row');
    expect(handle.parentElement?.style.alignItems).toBe('baseline');
    expect(handle.parentElement?.textContent).toBe('Carol Wynn@carol_wynn');
  });

  it('a long title takes two lines and a subtitle one', () => {
    texts.props = [];
    drawState('longTitle');
    const lines = (words: string): unknown =>
      texts.props.find((props) => props['children'] === words)?.['numberOfLines'];
    expect(lines(STATES.longTitle.title)).toBe(2);
    expect(lines(STATES.longTitle.subtitle)).toBe(1);
    // Nodes given as the subtitle are drawn as the caller made them.
    texts.props = [];
    draw({ subtitle: <Text role="caption">Filing closes Fri, Nov 27</Text> });
    expect(lines('Filing closes Fri, Nov 27')).toBeUndefined();
    expect(screen.getByText('Filing closes Fri, Nov 27')).toBeTruthy();
  });

  it('a setting or a count at the end of a row is part of its name', () => {
    // What a person reads on the row is what a screen reader and a voice command are given.
    const setting = draw({ href: '/dev/gallery', trailing: { kind: 'value', text: 'System' } });
    expect(setting.getAttribute('aria-label')).toBe('Notifications. System');
    const counted = draw({ onPress: () => undefined, trailing: { kind: 'count', value: 128 } });
    expect(counted.getAttribute('aria-label')).toBe('Notifications. 128');
    const both = draw({
      href: '/dev/gallery',
      subtitle: 'Mentions and replies',
      trailing: { kind: 'value', text: 'System' },
    });
    expect(both.getAttribute('aria-label')).toBe('Notifications. Mentions and replies. System');
    // A chevron says nothing.
    const plain = draw({ href: '/dev/gallery', trailing: { kind: 'chevron' } });
    expect(plain.getAttribute('aria-label')).toBe('Notifications');
  });

  it('the parts of a row read as separate words, in the order of its name', () => {
    // The words of a text: letters and digits, apart at anything else.
    const words = (text: string | null): string[] =>
      (text ?? '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word !== '');
    const setting = draw({
      href: '/dev/gallery',
      trailing: { kind: 'value', text: 'Match my device' },
    });
    expect(setting.textContent).toBe('Notifications Match my device');
    const counted = draw({ onPress: () => undefined, trailing: { kind: 'count', value: 128 } });
    expect(counted.textContent).toBe('Notifications 128');
    const captioned = draw({ href: '/dev/gallery', subtitle: 'Mentions and replies' });
    expect(captioned.textContent).toBe('Notifications Mentions and replies');
    const all = draw({
      href: '/dev/gallery',
      subtitle: 'Mentions and replies',
      trailing: { kind: 'value', text: 'System' },
    });
    expect(all.textContent).toBe('Notifications Mentions and replies System');
    // A row's name holds the words it shows, one after another.
    for (const row of [setting, counted, captioned, all]) {
      expect(words(row.textContent)).toEqual(words(row.getAttribute('aria-label')));
    }
    for (const state of ['value', 'count', 'iconLeading', 'unread'] as const) {
      const row = drawState(state);
      const name = words(row.getAttribute('aria-label')).join(' ');
      expect(` ${name} `, state).toContain(` ${words(row.textContent).join(' ')} `);
    }
    // A row with one part gains nothing, and a row that opens nothing reads the same way.
    expect(draw({ href: '/dev/gallery', trailing: { kind: 'chevron' } }).textContent).toBe(
      'Notifications',
    );
    expect(draw({ trailing: { kind: 'value', text: 'Soon' } }).textContent).toBe(
      'Notifications Soon',
    );
    // A space is out of the row's layout and hidden from a screen reader.
    const spaces = [...all.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter(
      (part) => part.textContent === ' ',
    );
    expect(spaces).toHaveLength(2);
    for (const space of spaces) {
      expect(space.parentElement?.style.position).toBe('absolute');
    }
  });

  it('link row', () => {
    const row = draw({ href: '/dev/gallery', subtitle: 'Mentions and replies' });
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('role')).toBe('link');
    expect(row.getAttribute('href')).toBe('/dev/gallery');
    expect(screen.getByRole('link', { name: 'Notifications. Mentions and replies' })).toBe(row);
    // Without a subtitle in words the name is the title.
    expect(draw({ href: '/dev/gallery' }).getAttribute('aria-label')).toBe('Notifications');
    expect(
      draw({ href: '/dev/gallery', subtitle: <IssueTile issueId="schools" /> }).getAttribute(
        'aria-label',
      ),
    ).toBe('Notifications');
    // A row that runs something on the page is a button.
    const button = draw({ onPress: () => undefined, subtitle: 'Mentions and replies' });
    expect(screen.getByRole('button', { name: 'Notifications. Mentions and replies' })).toBe(
      button,
    );
  });

  it('unread name', () => {
    const row = draw({
      href: '/dev/gallery',
      title: 'Dana Okafor',
      subtitle: 'Are you thinking of running?',
      unread: true,
    });
    expect(row.getAttribute('aria-label')).toBe(
      'Unread. Dana Okafor. Are you thinking of running?',
    );
    expect(draw({ onPress: () => undefined, unread: true }).getAttribute('aria-label')).toBe(
      'Unread. Notifications',
    );
    expect(draw({ onPress: () => undefined }).getAttribute('aria-label')).toBe('Notifications');
  });

  it('action is a sibling', () => {
    const onEdit = vi.fn();
    const onRow = vi.fn();
    const row = draw({
      href: '/dev/gallery',
      onPress: onRow,
      subtitle: 'Mentions and replies',
      trailing: edit(onEdit),
    });
    const button = screen.getByTestId(EDIT);
    // Neither target holds the other.
    expect(row.contains(button)).toBe(false);
    expect(button.contains(row)).toBe(false);
    expect(row.getAttribute('role')).toBe('link');
    // The button runs its own press and never the row's.
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    // A press on the row's words opens the row and never runs the button. The router follows an
    // in-app path itself and keeps the browser from loading it.
    row.addEventListener('click', (event) => {
      event.preventDefault();
    });
    fireEvent.click(screen.getByText('Notifications'));
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    // The fixture: the link and its button side by side in one row.
    const link = drawState('hrefWithAction');
    const beside = screen.getByTestId('gallery.list-row-href-with-action-edit');
    expect(link.contains(beside)).toBe(false);
    expect(frameOf(link).contains(beside)).toBe(true);
  });

  it('an action row is not a target', () => {
    const onEdit = vi.fn();
    const onRow = vi.fn();
    const row = draw({ onPress: onRow, trailing: edit(onEdit) });
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
    expect(screen.getAllByRole('button')).toEqual([screen.getByTestId(EDIT)]);
    fireEvent.click(screen.getByText('Notifications'));
    expect(onRow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(EDIT));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    // The same for the fixture, which has no press of its own.
    expect(drawState('action').getAttribute('role')).toBeNull();
  });

  it('the hovered ground reaches the tile', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hovered = (keyline: boolean): void => {
      cleanup();
      renderWithProviders(
        <InteractionPreview state={{ hovered: true }}>
          <ListRow
            {...STATES.issueLeading}
            leading={<IssueTile issueId="rent-housing" keyline={keyline} />}
          />
        </InteractionPreview>,
      );
    };
    expect(() => {
      hovered(false);
    }).toThrow('An issue tile on a hovered ground needs its keyline');
    cleanup();
    expect(() => {
      renderWithProviders(
        <InteractionPreview state={{ pressed: true }}>
          <ListRow
            {...STATES.issueLeading}
            leading={<IssueTile issueId="rent-housing" keyline={false} />}
          />
        </InteractionPreview>,
      );
    }).toThrow('An issue tile on a hovered ground needs its keyline');
    // With its keyline the tile is drawn on the fill.
    expect(() => {
      hovered(true);
    }).not.toThrow();
    const row = screen.getByTestId(STATES.issueLeading.testID);
    expect(row.style.backgroundColor).toBe(written(color.light.hoverBg));
    const tile = [...row.querySelectorAll<HTMLElement>('*')].find(
      (part) => part.style.width === '28px' && part.style.height === '28px',
    );
    expect(tile?.style.borderWidth).toBe('1px');
    // A row at rest asks nothing of its tile.
    cleanup();
    expect(() => {
      renderWithProviders(
        <ListRow
          {...STATES.issueLeading}
          leading={<IssueTile issueId="rent-housing" keyline={false} />}
        />,
      );
    }).not.toThrow();
    errors.mockRestore();
  });
});
