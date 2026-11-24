import { render, renderHook, screen } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import type * as ReactNative from 'react-native';
import { Text, View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { useFontsReady } from './fonts';
import { useReducedMotion } from './motion';
import { ThemeProvider, useTheme } from './theme';
import type { Theme, ThemeChoice } from './theme';

const scheme = vi.hoisted(() => {
  const state: { current: 'light' | 'dark' | null } = { current: 'light' };
  return state;
});

vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactNative>()),
  useColorScheme: () => scheme.current,
}));

function themeFor(choice: ThemeChoice, textScale?: number): Theme {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return textScale === undefined ? (
      <ThemeProvider choice={choice}>{children}</ThemeProvider>
    ) : (
      <ThemeProvider choice={choice} textScale={textScale}>
        {children}
      </ThemeProvider>
    );
  }
  return renderHook(() => useTheme(), { wrapper: Wrapper }).result.current;
}

/** #RRGGBB as the rgb() form a computed style reports. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

function groundOf(choice: ThemeChoice): string {
  const view = render(
    <ThemeProvider choice={choice}>
      <View testID="fixture.child" />
    </ThemeProvider>,
  );
  const root = screen.getByTestId('fixture.child').parentElement;
  if (root === null) throw new Error('the child has no parent');
  const ground = window.getComputedStyle(root).backgroundColor;
  view.unmount();
  return ground;
}

describe('ThemeProvider', () => {
  it('light and dark choices', () => {
    const dark = themeFor('dark');
    expect(dark.name).toBe('dark');
    expect(dark.color.bg).toBe('#121210');
    const light = themeFor('light');
    expect(light.name).toBe('light');
    expect(light.color.bg).toBe('#F1EFE7');
  });

  it('system follows the device', () => {
    scheme.current = 'dark';
    expect(themeFor('system').name).toBe('dark');
    scheme.current = null;
    expect(themeFor('system').name).toBe('light');
    scheme.current = 'light';
    expect(themeFor('system').name).toBe('light');
    // A stored choice wins over the device.
    scheme.current = 'dark';
    expect(themeFor('light').name).toBe('light');
    scheme.current = 'light';
  });

  it('issue colors by theme', () => {
    expect(themeFor('light').issue('climate')).toEqual({ fill: '#248F41', on: '#141412' });
    expect(themeFor('dark').issue('climate')).toEqual({ fill: '#42A859', on: '#141412' });
    expect(themeFor('light').issue('nope')).toBeNull();
  });

  it('text scale', () => {
    expect(themeFor('light').textScale).toBe(1);
    expect(themeFor('light', 1.3).textScale).toBe(1.3);
  });

  it('the root view takes the ground', () => {
    expect(groundOf('light')).toBe(rgb('#F1EFE7'));
    expect(groundOf('dark')).toBe(rgb('#121210'));
  });

  it('useTheme outside a provider throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => renderHook(() => useTheme())).toThrow('useTheme needs a ThemeProvider');
    } finally {
      quiet.mockRestore();
    }
  });

  it('the test render mounts the design providers', () => {
    function DesignProbe(): JSX.Element {
      const theme = useTheme();
      const words = [
        theme.name,
        String(theme.textScale),
        useReducedMotion() ? 'reduced' : 'moving',
        useFontsReady() ? 'fonts' : 'no-fonts',
      ];
      return <Text testID="fixture.design">{words.join(' ')}</Text>;
    }
    const first = renderWithProviders(<DesignProbe />);
    expect(screen.getByTestId('fixture.design').textContent).toBe('light 1 moving fonts');
    first.unmount();
    renderWithProviders(<DesignProbe />, { theme: 'dark', textScale: 1.3, reducedMotion: true });
    expect(screen.getByTestId('fixture.design').textContent).toBe('dark 1.3 reduced fonts');
  });
});
