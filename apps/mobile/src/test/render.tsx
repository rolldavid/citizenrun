import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { JSX, ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { getI18n } from '@/lib/i18n';
import { links } from '@/platform/links';
import type { PageKeyEvent } from '@/platform/links';
import { FontsProvider } from '@/ui/fonts';
import { ReducedMotionOverride } from '@/ui/motion';
import { ShortcutProvider } from '@/ui/shortcuts';
import { ThemeProvider } from '@/ui/theme';

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

/** Renders `ui` inside the i18n, theme, reduced-motion, fonts and shortcut providers the app mounts. */
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
      <I18nextProvider i18n={i18n}>
        <ThemeProvider choice={theme} textScale={textScale}>
          <ReducedMotionOverride value={reducedMotion}>
            <FontsProvider ready={true}>
              <ShortcutProvider subscribeKeyDown={subscribeKeyDown}>{children}</ShortcutProvider>
            </FontsProvider>
          </ReducedMotionOverride>
        </ThemeProvider>
      </I18nextProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}
