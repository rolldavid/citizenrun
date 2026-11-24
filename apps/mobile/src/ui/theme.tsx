import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { JSX, ReactNode } from 'react';
import { useColorScheme, View } from 'react-native';

import { color, isIssueId, issue } from './tokens';
import type { ThemeColors, ThemeName } from './tokens';

export type ThemeChoice = 'system' | 'light' | 'dark';

export type Theme = {
  name: ThemeName;
  color: ThemeColors;
  /** The fill and glyph color of an issue in this theme, or null for an id this build does not know. */
  issue(id: string): { fill: string; on: string } | null;
  /** Multiplies type sizes and line heights in C-Text. 1 everywhere except the dev routes. */
  textScale: number;
};

export type ThemeProviderProps = {
  /** The person's stored choice. The root layout reads and saves it through the storage platform module. */
  choice: ThemeChoice;
  /** Dev routes only: a text-scale override, from the query parameter textScale. */
  textScale?: number;
  children: ReactNode;
};

const ThemeContext = createContext<Theme | null>(null);

/** Sets the color behind the root view. Where the system refuses, it keeps its own: nothing depends on it. */
async function paintSystemBackground(ground: string): Promise<void> {
  try {
    await setBackgroundColorAsync(ground);
  } catch {
    // dropped
  }
}

/**
 * Publishes the theme and paints the ground under its children: the root view, the status bar and
 * the system background follow it. A theme change is a cut. The innermost provider wins.
 */
export function ThemeProvider({
  choice,
  textScale = 1,
  children,
}: ThemeProviderProps): JSX.Element {
  // The only call of useColorScheme in the app. No scheme, or one that is not dark, is light.
  const system = useColorScheme();
  const name: ThemeName = choice === 'system' ? (system === 'dark' ? 'dark' : 'light') : choice;
  const theme = useMemo<Theme>(
    () => ({
      name,
      color: color[name],
      issue: (id) => (isIssueId(id) ? { fill: issue[id][name], on: issue[id].on } : null),
      textScale,
    }),
    [name, textScale],
  );
  const ground = theme.color.bg;

  useEffect(() => {
    void paintSystemBackground(ground);
  }, [ground]);

  return (
    <ThemeContext.Provider value={theme}>
      <StatusBar style={name === 'light' ? 'dark' : 'light'} />
      <View style={{ flex: 1, backgroundColor: ground }}>{children}</View>
    </ThemeContext.Provider>
  );
}

/** The theme of the nearest ThemeProvider. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error('useTheme needs a ThemeProvider');
  }
  return theme;
}
