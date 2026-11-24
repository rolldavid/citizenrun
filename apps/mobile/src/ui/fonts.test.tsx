import { renderHook } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FONT_FACES, FontsProvider, useFontsReady } from './fonts';

function readyUnder(ready: boolean | null): boolean {
  if (ready === null) {
    return renderHook(() => useFontsReady()).result.current;
  }
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <FontsProvider ready={ready === true}>{children}</FontsProvider>;
  }
  return renderHook(() => useFontsReady(), { wrapper: Wrapper }).result.current;
}

describe('the fonts-ready signal', () => {
  it('is false outside a provider and follows ready inside one', () => {
    expect(readyUnder(null)).toBe(false);
    expect(readyUnder(true)).toBe(true);
    expect(readyUnder(false)).toBe(false);
  });

  it('FONT_FACES are the four faces in order', () => {
    expect(FONT_FACES).toEqual([
      { family: 'Special Gothic', weight: 400 },
      { family: 'Special Gothic', weight: 500 },
      { family: 'Special Gothic', weight: 700 },
      { family: 'Chivo Mono', weight: 500 },
    ]);
  });
});
