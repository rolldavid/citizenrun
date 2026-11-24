import { act, render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { JSX, ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { vi } from 'vitest';

import { getI18n } from '@/lib/i18n';
import { links } from '@/platform/links';
import type { PageKeyEvent } from '@/platform/links';
import { FontsProvider } from '@/ui/fonts';
import { ReducedMotionOverride } from '@/ui/motion';
import { ShortcutProvider } from '@/ui/shortcuts';
import { ThemeProvider } from '@/ui/theme';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);

/** A phone-sized frame with no insets: fixture values, so nothing waits for the safe area to be measured. */
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

/** The platform's key subscription, as a stable function the shortcut provider can hold. */
function subscribeKeyDown(listener: (event: PageKeyEvent) => void): () => void {
  return links.subscribeKeyDown(listener);
}

export type RenderWithProvidersOptions = {
  /** Default 'light'. */
  theme?: 'light' | 'dark';
  /** Default 1. */
  textScale?: number;
  /** Default false. */
  reducedMotion?: boolean;
};

/**
 * Renders `ui` inside the safe-area, i18n, theme, reduced-motion, fonts and shortcut providers the
 * app mounts.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { theme = 'light', textScale = 1, reducedMotion = false } = options;
  const i18n = getI18n();
  if (i18n.language !== 'en') {
    void i18n.changeLanguage('en');
  }
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider choice={theme} textScale={textScale}>
            <ReducedMotionOverride value={reducedMotion}>
              <FontsProvider ready={true}>
                <ShortcutProvider subscribeKeyDown={subscribeKeyDown}>{children}</ShortcutProvider>
              </FontsProvider>
            </ReducedMotionOverride>
          </ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

/**
 * Sets the size of the window. The size stays for the rest of the test file, so a file that calls
 * this sets the viewport it needs before each render.
 */
export function setViewport(width: number, height: number): void {
  // The page reads the window's size from the root element where there is no visual viewport.
  const root = document.documentElement;
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}
