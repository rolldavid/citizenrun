import { FONT_CSS } from '@citizenrun/shared';
import { createContext, useContext } from 'react';
import type { JSX, ReactNode } from 'react';

export type FontsProviderProps = { ready: boolean; children: ReactNode };

const FontsReadyContext = createContext(false);

/** Publishes whether the four faces have loaded. The root layout supplies the answer. */
export function FontsProvider({ ready, children }: FontsProviderProps): JSX.Element {
  return <FontsReadyContext.Provider value={ready}>{children}</FontsReadyContext.Provider>;
}

/** True once the four faces have loaded; false outside a provider. */
export function useFontsReady(): boolean {
  return useContext(FontsReadyContext);
}

/** The four faces the web page waits for, as FONT_CSS names them (family and weight). */
export const FONT_FACES: readonly { family: string; weight: number }[] = Object.values(
  FONT_CSS,
).map(({ family, weight }) => ({ family, weight }));
