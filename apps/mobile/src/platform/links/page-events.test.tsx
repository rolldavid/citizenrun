import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { PageKeyEvent } from './types';

const { links: web } = await vi.importActual<typeof WebIndex>('./index.web');
const { links: phone } = await vi.importActual<typeof NativeIndex>('./index.native');

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function field(tag: 'input' | 'textarea'): HTMLElement {
  const element = document.createElement(tag);
  document.body.append(element);
  return element;
}

function stubFonts(fonts: unknown): void {
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts');
  document.body.replaceChildren();
});

describe('page events', () => {
  it('key presses', () => {
    const events: PageKeyEvent[] = [];
    const unsubscribe = web.subscribeKeyDown((event) => {
      events.push(event);
    });

    press(document.body, { key: 'j', altKey: true, ctrlKey: false, metaKey: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      key: 'j',
      altKey: true,
      ctrlKey: false,
      metaKey: true,
      inTextField: false,
    });

    press(field('input'), { key: 'j' });
    press(field('textarea'), { key: 'k', ctrlKey: true });
    expect(events[1]).toMatchObject({ key: 'j', inTextField: true });
    expect(events[2]).toMatchObject({ key: 'k', ctrlKey: true, inTextField: true });

    press(document.body, { key: 'j', isComposing: true });
    expect(events).toHaveLength(3);

    const unsubscribeNext = web.subscribeKeyDown((event) => {
      event.preventDefault();
    });
    const prevented = press(document.body, { key: '/' });
    expect(prevented.defaultPrevented).toBe(true);
    unsubscribeNext();

    unsubscribe();
    unsubscribe();
    const after = press(document.body, { key: 'j' });
    expect(events).toHaveLength(4);
    expect(after.defaultPrevented).toBe(false);

    const phoneListener = vi.fn();
    const phoneUnsubscribe = phone.subscribeKeyDown(phoneListener);
    press(document.body, { key: 'j' });
    press(field('input'), { key: 'j' });
    phoneUnsubscribe();
    phoneUnsubscribe();
    expect(phoneListener).not.toHaveBeenCalled();
  });

  it('fonts ready', async () => {
    const load = vi.fn((_font: string) => Promise.resolve([{}]));
    stubFonts({ load });
    const faces = [
      { family: 'Fixture Sans', weight: 400 },
      { family: 'Fixture Sans', weight: 500 },
      { family: 'Fixture Serif', weight: 400 },
      { family: 'Fixture Serif', weight: 700 },
    ];
    expect(await web.fontsReady(faces)).toBe(true);
    expect(load).toHaveBeenCalledTimes(4);
    expect(load).toHaveBeenCalledWith('500 16px "Fixture Sans"');

    load.mockImplementation((font) => Promise.resolve(font.includes('700') ? [] : [{}]));
    expect(await web.fontsReady(faces)).toBe(false);

    load.mockImplementation((font) =>
      font.includes('700') ? Promise.reject(new Error('fixture')) : Promise.resolve([{}]),
    );
    expect(await web.fontsReady(faces)).toBe(false);

    stubFonts(undefined);
    expect(await web.fontsReady(faces)).toBe(false);

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      get() {
        throw new Error('fixture: the phone file never reads the page');
      },
    });
    expect(await phone.fontsReady(faces)).toBe(true);
  });
});
