import { createI18n } from '@citizenrun/shared';
import { cleanup } from '@testing-library/react';
import type { PostProcessorModule } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCREEN_FIXTURES } from '@/features/dev/screen-fixtures';
import { renderWithProviders, setViewport } from '@/test/render';

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
// that did not come through t().

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

/** Every text node of the container that holds a letter and is not wholly bracketed. */
function untranslatedText(container: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (LETTER.test(text) && !BRACKETED.test(text)) {
      found.push(text);
    }
  }
  return found;
}

/** Draws one pair at a phone width and at a desktop width, and returns any text outside t(). */
function escapedText(screen: string, fixture: string): string[] {
  const found: string[] = [];
  for (const [width, height] of [COMPACT, EXPANDED]) {
    setViewport(width, height);
    const { container, unmount } = renderWithProviders(
      <FixtureView screen={screen} fixture={fixture} />,
      { i18n: pseudoInstance },
    );
    expect(container.textContent).not.toBe('');
    found.push(...untranslatedText(container));
    unmount();
  }
  return found;
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

  for (const [screen, fixture] of PAIRS) {
    it(`${screen} ${fixture} shows only translated text`, () => {
      expect(escapedText(screen, fixture)).toEqual([]);
    });
  }

  it('an unknown pair shows translated not-found text', () => {
    expect(escapedText('none', 'none')).toEqual([]);
  });
});
