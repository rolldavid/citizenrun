import { useMemo } from 'react';

import { useTheme } from '@/ui/theme';
import type { Theme } from '@/ui/theme';

/** The part of a navigation library's theme the app sets: whether it is dark, and its six colors. */
export type NavigatorTheme = {
  dark: boolean;
  colors: {
    primary: string;
    background: string;
    card: string;
    text: string;
    border: string;
    notification: string;
  };
};

/**
 * Pure. The navigation library's theme `base` with the app's ground, ink and rule in place of the
 * library's own colors: a navigator's scene and card are `bg`, so a route that paints no ground of
 * its own shows the page ground and never the library's gray. Everything else of `base` is kept.
 */
export function navigatorThemeFor<Base extends { dark: boolean; colors: object }>(
  base: Base,
  theme: Theme,
): Omit<Base, 'dark' | 'colors'> & NavigatorTheme {
  return {
    ...base,
    dark: theme.name === 'dark',
    colors: {
      ...base.colors,
      primary: theme.color.text,
      background: theme.color.bg,
      card: theme.color.bg,
      text: theme.color.text,
      border: theme.color.rule,
      notification: theme.color.inverseBg,
    },
  };
}

/** `navigatorThemeFor` over the theme of the nearest ThemeProvider. The root layout hands it to the navigators. */
export function useNavigatorTheme<Base extends { dark: boolean; colors: object }>(
  base: Base,
): Omit<Base, 'dark' | 'colors'> & NavigatorTheme {
  const theme = useTheme();
  return useMemo(() => navigatorThemeFor(base, theme), [base, theme]);
}
