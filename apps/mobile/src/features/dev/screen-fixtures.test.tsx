import { BRAND, createI18n } from '@citizenrun/shared';
import { cleanup } from '@testing-library/react';
import type { PostProcessorModule } from 'i18next';
import { isValidElement } from 'react';
import type { JSX, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCREEN_FIXTURES } from '@/features/dev/screen-fixtures';
import { renderWithProviders, setViewport } from '@/test/render';
import { avatarInitials } from '@/ui/components/avatar';

import { FixtureView } from './screens/fixture-screen';

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
// A drawing of the app loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));

// TEST-i18n `pseudo-locale renders`: every screen fixture, drawn in a pseudo-locale, shows no text
// that did not come through t(). The whole document is read, so a sheet or dialog drawn in a portal
// outside the render container is judged too.

/** A pseudo-locale string: 40% longer and bracketed, so text that escaped t() stands out. */
function pseudo(value: string): string {
  return '[' + value + '~'.repeat(Math.ceil(value.length * 0.4)) + ']';
}

const PSEUDO: PostProcessorModule = {
  type: 'postProcessor',
  name: 'pseudo',
  process: (value: string) => pseudo(value),
};

/** The test's own instance with the pseudo post-processor; the app's instance is never touched. */
const pseudoInstance = createI18n();
pseudoInstance.use(PSEUDO);
pseudoInstance.options.postProcess = ['pseudo'];

const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;

const LETTER = /\p{L}/u;
const BRACKETED = /^\[[\s\S]*\]$/u;

/**
 * True when the text is one pseudo string: it opens with a bracket whose matching close is its last
 * character. "[A~] typed [B~]" is not, so text typed by hand between two strings is never accepted.
 */
function whollyBracketed(text: string): boolean {
  if (!text.startsWith('[') || !text.endsWith(']')) {
    return false;
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return index === text.length - 1;
      }
    }
  }
  return false;
}

/**
 * True when the text node is a part of one translated sentence that tags split into several nodes
 * (a link inside a sentence): an element around it holds the whole sentence as one pseudo string.
 */
function insideTranslatedSentence(node: Node, root: Node): boolean {
  for (let element = node.parentElement; element !== null; element = element.parentElement) {
    if (whollyBracketed(element.textContent.trim())) {
      return true;
    }
    if (element === root) {
      return false;
    }
  }
  return false;
}

/**
 * Every text node under the root that holds a letter, is not wholly bracketed, is not a part of a
 * bracketed sentence and is not one of the `data` strings (the fixture's own values: a name, a bio, an
 * email address, the brand's name).
 */
function untranslatedText(root: Node, data: ReadonlySet<string> = new Set()): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (
      LETTER.test(text) &&
      !BRACKETED.test(text) &&
      !data.has(text) &&
      !insideTranslatedSentence(node, root)
    ) {
      found.push(text);
    }
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The strings a fixture carries as data: every string in the props its entry draws the view with,
 * the initials an avatar draws from a person's name and handle, and the brand's name.
 */
function fixtureData(screen: string, fixture: string): Set<string> {
  const data = new Set<string>([BRAND.displayName]);
  const entry = Object.hasOwn(SCREEN_FIXTURES, screen) ? SCREEN_FIXTURES[screen] : undefined;
  const element: ReactElement | null = entry?.render(fixture) ?? null;
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      data.add(value.trim());
      return;
    }
    if (!isRecord(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    const name = value['name'];
    const handle = value['handle'];
    if (
      (typeof name === 'string' || name === null) &&
      (typeof handle === 'string' || handle === null)
    ) {
      data.add(avatarInitials(name, handle));
    }
    for (const child of Object.values(value)) {
      visit(child);
    }
  };
  if (element !== null && isValidElement(element)) {
    visit(element.props);
  }
  return data;
}

/** Draws an element and returns the text of the whole document outside t() and outside `data`. */
function drawnText(element: ReactElement, data: ReadonlySet<string>): string[] {
  const { unmount } = renderWithProviders(element, { i18n: pseudoInstance });
  expect(document.body.textContent).not.toBe('');
  const found = untranslatedText(document.body, data);
  unmount();
  return found;
}

/** Draws one pair at a phone width and at a desktop width, and returns any text outside t(). */
function escapedText(screen: string, fixture: string): string[] {
  const data = fixtureData(screen, fixture);
  const found: string[] = [];
  for (const [width, height] of [COMPACT, EXPANDED]) {
    setViewport(width, height);
    found.push(...drawnText(<FixtureView screen={screen} fixture={fixture} />, data));
  }
  return found;
}

/** Text drawn in a portal on the document's body, outside the render container, as a sheet is. */
function InPortal({ text }: { text: string }): JSX.Element {
  return createPortal(<p>{text}</p>, document.body);
}

const PAIRS = Object.entries(SCREEN_FIXTURES).flatMap(([screen, entry]) =>
  entry.fixtures.map((fixture) => [screen, fixture] as const),
);

afterEach(() => {
  cleanup();
});

describe('pseudo-locale renders', () => {
  it('the pseudo-locale brackets and lengthens a translated string', () => {
    expect(pseudoInstance.t('common:ui.retry')).toBe('[Try again~~~~]');
  });

  it('finds text that did not come through t()', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>[Translated~~~]</p><p>Typed by hand</p><p>42</p>';
    expect(untranslatedText(container)).toEqual(['Typed by hand']);
  });

  it('finds text that did not come through t() in a portal outside the render container', () => {
    expect(drawnText(<InPortal text="Typed by hand" />, new Set())).toEqual(['Typed by hand']);
    expect(drawnText(<InPortal text="[Translated~~~]" />, new Set())).toEqual([]);
  });

  it('accepts the parts of one translated sentence that link tags split', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>[By tapping Agree you accept the <a>Terms</a>, and you have read the <a>Privacy policy</a>.~~~]</p>';
    expect(untranslatedText(container)).toEqual([]);
  });

  it('finds a link typed by hand between two translated strings', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>[Read the~~] <a>Terms</a> [today~~]</p>';
    expect(untranslatedText(container)).toEqual(['Terms']);
  });

  it("accepts only the fixture's own data and the brand's name", () => {
    const container = document.createElement('div');
    container.innerHTML = `<p>Fixture bio text.</p><p>${BRAND.displayName}</p><p>Typed by hand</p>`;
    expect(untranslatedText(container, new Set(['Fixture bio text.', BRAND.displayName]))).toEqual([
      'Typed by hand',
    ]);
    expect(untranslatedText(container)).toEqual([
      'Fixture bio text.',
      BRAND.displayName,
      'Typed by hand',
    ]);
  });

  for (const [screen, fixture] of PAIRS) {
    it(`${screen} ${fixture} shows only translated text`, () => {
      expect(escapedText(screen, fixture)).toEqual([]);
    });
  }

  it('an unknown pair shows translated not-found text', () => {
    expect(escapedText('none', 'none')).toEqual([]);
  });
});
