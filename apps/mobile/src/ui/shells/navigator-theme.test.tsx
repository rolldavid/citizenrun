import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { Theme } from '@/ui/theme';
import { color } from '@/ui/tokens';

import { navigatorThemeFor, useNavigatorTheme } from './navigator-theme';
import type { NavigatorTheme } from './navigator-theme';

/** The navigation library's own light theme, as it ships: its ground is a gray. */
const LIBRARY = {
  dark: false,
  colors: {
    primary: 'rgb(0, 122, 255)',
    background: 'rgb(242, 242, 242)',
    card: 'rgb(255, 255, 255)',
    text: 'rgb(28, 28, 30)',
    border: 'rgb(216, 216, 216)',
    notification: 'rgb(255, 59, 48)',
  },
  fonts: { regular: { fontFamily: 'System', fontWeight: '400' } },
} as const;

function themeOf(name: 'light' | 'dark'): Theme {
  return { name, color: color[name], issue: () => null, textScale: 1 };
}

afterEach(cleanup);

describe('the navigators stand on the ground of the theme', () => {
  it('replaces every color of the library with a token of the theme', () => {
    for (const name of ['light', 'dark'] as const) {
      const made = navigatorThemeFor(LIBRARY, themeOf(name));
      expect(made.dark, name).toBe(name === 'dark');
      expect(made.colors, name).toEqual({
        primary: color[name].text,
        background: color[name].bg,
        card: color[name].bg,
        text: color[name].text,
        border: color[name].rule,
        notification: color[name].inverseBg,
      });
      // Nothing of the library's own palette is left: a route that paints no ground is not gray.
      for (const value of Object.values(made.colors)) {
        expect(Object.values(LIBRARY.colors), name).not.toContain(value);
      }
      // What is not a color is the library's.
      expect(made.fonts, name).toBe(LIBRARY.fonts);
    }
    // The library's theme is not changed.
    expect(LIBRARY.colors.background).toBe('rgb(242, 242, 242)');
  });

  it('the hook follows the theme around it', () => {
    const seen: NavigatorTheme[] = [];
    function Probe(): null {
      seen.push(useNavigatorTheme(LIBRARY));
      return null;
    }
    const drawn = (theme: 'light' | 'dark'): NavigatorTheme => {
      cleanup();
      renderWithProviders(<Probe />, { theme });
      const made = seen.at(-1);
      if (made === undefined) {
        throw new Error('the probe was not drawn');
      }
      return made;
    };
    expect(drawn('light').colors.background).toBe(color.light.bg);
    expect(drawn('light').dark).toBe(false);
    expect(drawn('dark').colors.background).toBe(color.dark.bg);
    expect(drawn('dark').dark).toBe(true);
  });
});
