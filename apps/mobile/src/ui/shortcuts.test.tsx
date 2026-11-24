import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { links, linksFake } from '@/test/platform/links';

import {
  ShortcutProvider,
  useActiveShortcuts,
  useEscapeListener,
  useShortcut,
  useShortcutBlocker,
} from './shortcuts';
import type { KeyEventLike } from './shortcuts';

type KeyEvent = KeyEventLike & { preventDefault: Mock<() => void> };

function key(k: string, overrides: Partial<Omit<KeyEventLike, 'preventDefault'>> = {}): KeyEvent {
  return {
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    inTextField: false,
    ...overrides,
    preventDefault: vi.fn<() => void>(),
  };
}

function emit(event: KeyEventLike): void {
  act(() => {
    linksFake.emitKey(event);
  });
}

function Shortcut(props: {
  k: string;
  description?: string;
  onKey: () => void;
  enabled?: boolean;
}): null {
  useShortcut(
    { key: props.k, description: props.description ?? `fixture ${props.k}`, handler: props.onKey },
    props.enabled ?? true,
  );
  return null;
}

function Blocker({ active }: { active: boolean }): null {
  useShortcutBlocker(active);
  return null;
}

function EscapeListener(props: { onEscape: () => void; enabled: boolean }): null {
  useEscapeListener(props.onEscape, props.enabled);
  return null;
}

type ActiveList = readonly { key: string; description: string }[];

/** Reports the active list each time it changes. */
function ActiveListProbe({ onList }: { onList: (list: ActiveList) => void }): null {
  const list = useActiveShortcuts();
  useEffect(() => {
    onList(list);
  }, [list, onList]);
  return null;
}

function subscribeKeyDown(listener: (event: KeyEventLike) => void): () => void {
  return links.subscribeKeyDown(listener);
}

function Provider({ children }: { children: ReactNode }): ReactElement {
  return <ShortcutProvider subscribeKeyDown={subscribeKeyDown}>{children}</ShortcutProvider>;
}

function subscriptions(): number {
  return linksFake.calls.filter((call) => call.op === 'subscribeKeyDown').length;
}

describe('the shortcut registry', () => {
  it('a registered key fires once and prevents the default', () => {
    const onKey = vi.fn();
    render(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
      </Provider>,
    );
    const event = key('j');
    emit(event);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    const other = key('k');
    emit(other);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it('letters match in either case', () => {
    const onKey = vi.fn();
    render(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
      </Provider>,
    );
    emit(key('J'));
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('other keys match exactly', () => {
    const onSlash = vi.fn();
    render(
      <Provider>
        <Shortcut k="/" onKey={onSlash} />
      </Provider>,
    );
    emit(key('?'));
    expect(onSlash).not.toHaveBeenCalled();
    emit(key('/'));
    expect(onSlash).toHaveBeenCalledTimes(1);
  });

  it('nothing fires in a text field or with a modifier', () => {
    const onKey = vi.fn();
    render(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
      </Provider>,
    );
    for (const blocked of [
      key('j', { inTextField: true }),
      key('j', { altKey: true }),
      key('j', { ctrlKey: true }),
      key('j', { metaKey: true }),
    ]) {
      emit(blocked);
      expect(blocked.preventDefault).not.toHaveBeenCalled();
    }
    expect(onKey).not.toHaveBeenCalled();
    emit(key('j'));
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('nothing fires while a blocker is active', () => {
    const onKey = vi.fn();
    const view = render(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
        <Blocker active={true} />
      </Provider>,
    );
    const blocked = key('j');
    emit(blocked);
    expect(onKey).not.toHaveBeenCalled();
    expect(blocked.preventDefault).not.toHaveBeenCalled();
    view.rerender(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
      </Provider>,
    );
    emit(key('j'));
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('disabled and unmounted shortcuts do not fire', () => {
    const onKey = vi.fn();
    const view = render(
      <Provider>
        <Shortcut k="j" onKey={onKey} enabled={false} />
      </Provider>,
    );
    emit(key('j'));
    expect(onKey).not.toHaveBeenCalled();
    view.rerender(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
      </Provider>,
    );
    emit(key('j'));
    expect(onKey).toHaveBeenCalledTimes(1);
    view.rerender(<Provider>{null}</Provider>);
    emit(key('j'));
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('the latest handler runs without registering again', () => {
    const lists: ActiveList[] = [];
    const record = (list: ActiveList): void => {
      lists.push(list);
    };
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <Provider>
        <Shortcut k="j" onKey={first} />
        <ActiveListProbe onList={record} />
      </Provider>,
    );
    view.rerender(
      <Provider>
        <Shortcut k="j" onKey={second} />
        <ActiveListProbe onList={record} />
      </Provider>,
    );
    emit(key('j'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(lists.at(-1)).toEqual([{ key: 'j', description: 'fixture j' }]);
  });

  it('two handlers for one key is a development error', () => {
    expect(__DEV__).toBe(true);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        render(
          <Provider>
            <Shortcut k="/" onKey={() => undefined} />
            <Shortcut k="/" onKey={() => undefined} />
          </Provider>,
        ),
      ).toThrow('Two shortcuts registered for "/"');
    } finally {
      quiet.mockRestore();
    }
  });

  it('the active list', () => {
    const lists: ActiveList[] = [];
    const record = (list: ActiveList): void => {
      lists.push(list);
    };
    const view = render(
      <Provider>
        <Shortcut k="j" description="Next" onKey={() => undefined} />
        <Shortcut k="k" description="Previous" onKey={() => undefined} />
        <Shortcut k="/" description="Search" onKey={() => undefined} />
        <ActiveListProbe onList={record} />
      </Provider>,
    );
    expect(lists.at(-1)).toEqual([
      { key: 'j', description: 'Next' },
      { key: 'k', description: 'Previous' },
      { key: '/', description: 'Search' },
    ]);
    view.rerender(
      <Provider>
        <Shortcut k="j" description="Next" onKey={() => undefined} />
        <Shortcut k="/" description="Search" onKey={() => undefined} />
        <ActiveListProbe onList={record} />
      </Provider>,
    );
    expect(lists.at(-1)).toEqual([
      { key: 'j', description: 'Next' },
      { key: '/', description: 'Search' },
    ]);
  });

  it('the registry subscribes once', () => {
    const onKey = vi.fn();
    const view = render(
      <Provider>
        <Shortcut k="j" onKey={onKey} />
        <Shortcut k="k" onKey={onKey} />
        <Shortcut k="/" onKey={onKey} />
      </Provider>,
    );
    expect(subscriptions()).toBe(1);
    view.unmount();
    emit(key('j'));
    emit(key('/'));
    expect(onKey).not.toHaveBeenCalled();
  });

  it('an escape listener hears Escape while enabled', () => {
    const lists: ActiveList[] = [];
    const record = (list: ActiveList): void => {
      lists.push(list);
    };
    const enabled = vi.fn();
    const disabled = vi.fn();
    const view = render(
      <Provider>
        <Shortcut k="j" onKey={() => undefined} />
        <EscapeListener onEscape={enabled} enabled={true} />
        <EscapeListener onEscape={disabled} enabled={false} />
        <ActiveListProbe onList={record} />
      </Provider>,
    );
    const event = key('Escape');
    emit(event);
    expect(enabled).toHaveBeenCalledTimes(1);
    expect(disabled).not.toHaveBeenCalled();
    // The registry holds no Escape of its own: the key keeps its default and is never listed.
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(lists.at(-1)).toEqual([{ key: 'j', description: 'fixture j' }]);
    expect(subscriptions()).toBe(1);

    // Every other key passes it by.
    emit(key('j'));
    emit(key('Enter'));
    expect(enabled).toHaveBeenCalledTimes(1);

    // It hears Escape in a text field, with a modifier down and behind a blocker.
    view.rerender(
      <Provider>
        <Shortcut k="j" onKey={() => undefined} />
        <EscapeListener onEscape={enabled} enabled={true} />
        <EscapeListener onEscape={disabled} enabled={false} />
        <ActiveListProbe onList={record} />
        <Blocker active={true} />
      </Provider>,
    );
    emit(key('Escape', { inTextField: true }));
    emit(key('Escape', { ctrlKey: true }));
    expect(enabled).toHaveBeenCalledTimes(3);

    // The latest handler runs, and a listener that is switched off or unmounted hears nothing.
    const later = vi.fn();
    view.rerender(
      <Provider>
        <EscapeListener onEscape={later} enabled={true} />
        <EscapeListener onEscape={disabled} enabled={false} />
      </Provider>,
    );
    emit(key('Escape'));
    expect(later).toHaveBeenCalledTimes(1);
    expect(enabled).toHaveBeenCalledTimes(3);
    view.rerender(
      <Provider>
        <EscapeListener onEscape={later} enabled={false} />
      </Provider>,
    );
    emit(key('Escape'));
    expect(later).toHaveBeenCalledTimes(1);
    expect(disabled).not.toHaveBeenCalled();
    expect(subscriptions()).toBe(1);
  });
});
