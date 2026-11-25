import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { KeyGroup } from './key-group';
import type { KeyGroupKey, KeyGroupProps } from './key-group';
import { Pressable } from './pressable';
import { Text } from './text';

const GROUP = 'probe.key-group';
const FIRST = 'probe.key-group-first';
const SECOND = 'probe.key-group-second';

/** Renders a group of two options, each a press target of its own. */
function draw(given: Partial<KeyGroupProps> & Pick<KeyGroupProps, 'onKeyDown'>): HTMLElement {
  cleanup();
  renderWithProviders(
    <KeyGroup role="radiogroup" accessibilityLabel="Theme" testID={GROUP} {...given}>
      <Pressable role="radio" label="Light" testID={FIRST}>
        <Text role="body">Light</Text>
      </Pressable>
      <Pressable role="radio" label="Dark" focusable={false} testID={SECOND}>
        <Text role="body">Dark</Text>
      </Pressable>
    </KeyGroup>,
  );
  return screen.getByTestId(GROUP);
}

/** Gives the option focus, as Tab or a group's own key handling does. */
function focus(testID: string): HTMLElement {
  const option = screen.getByTestId(testID);
  act(() => {
    option.focus();
  });
  return option;
}

describe('KeyGroup', () => {
  it('keys bubble to the group', () => {
    const keys: string[] = [];
    draw({
      onKeyDown: (event) => {
        keys.push(event.key);
      },
    });
    fireEvent.keyDown(focus(FIRST), { key: 'ArrowDown' });
    // An option out of the Tab order holds the focus the group gives it, and its keys arrive too.
    fireEvent.keyDown(focus(SECOND), { key: 'ArrowUp' });
    fireEvent.keyDown(focus(SECOND), { key: 'f' });
    expect(keys).toEqual(['ArrowDown', 'ArrowUp', 'f']);
  });

  it('the group stops what the page would do with a key, and only when it asks', () => {
    draw({
      onKeyDown: (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
        }
      },
    });
    // fireEvent answers false for an event that was cancelled.
    expect(fireEvent.keyDown(focus(FIRST), { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(focus(FIRST), { key: 'Tab' })).toBe(true);
  });

  it('a shortcut of the browser or the system never reaches the group', () => {
    const onKeyDown = vi.fn<(event: KeyGroupKey) => void>((event) => {
      event.preventDefault();
    });
    draw({ onKeyDown });
    const option = focus(FIRST);
    expect(fireEvent.keyDown(option, { key: 'ArrowLeft', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(option, { key: 'r', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(option, { key: 'f', ctrlKey: true })).toBe(true);
    expect(onKeyDown).not.toHaveBeenCalled();
    // Shift is no shortcut: it types a capital.
    expect(fireEvent.keyDown(option, { key: 'F', shiftKey: true })).toBe(false);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('F');
  });

  it('has a role and a name', () => {
    const group = draw({ onKeyDown: vi.fn() });
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBe(group);
    // The group itself is no stop in the Tab order: its one option is.
    expect(group.hasAttribute('tabindex')).toBe(false);
    const list = draw({ role: 'listbox', onKeyDown: vi.fn() });
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.hasAttribute('tabindex')).toBe(false);
  });
});
