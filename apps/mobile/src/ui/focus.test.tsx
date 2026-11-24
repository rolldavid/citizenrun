import { cleanup, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { HostInstance } from 'react-native';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { setPageLoad } from './first-screen';
import { focusRingStyle, useFocusOnMount } from './focus';
import type { Theme } from './theme';
import { color, radius } from './tokens';

function themeOf(name: 'light' | 'dark'): Theme {
  return { name, color: color[name], issue: () => null, textScale: 1 };
}

function Heading(): ReactElement {
  const ref = useRef<HostInstance | null>(null);
  useFocusOnMount(ref);
  return (
    <View>
      <View testID="fixture.before" tabIndex={0} />
      <View ref={ref} testID="fixture.heading" tabIndex={-1} />
    </View>
  );
}

describe('focus', () => {
  it('focusRingStyle draws the ring in focusRing', () => {
    expect(focusRingStyle(themeOf('light'), radius.control)).toEqual({
      outlineStyle: 'solid',
      outlineWidth: 2,
      outlineColor: '#141412',
      outlineOffset: 2,
      borderRadius: 4,
    });
    expect(focusRingStyle(themeOf('dark'), radius.control).outlineColor).toBe('#F3F1EA');
  });

  it('useFocusOnMount focuses its target after mount', () => {
    renderWithProviders(<Heading />, { theme: 'dark' });
    const heading = screen.getByTestId('fixture.heading');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('the first screen of a page load keeps the focus where the document starts it', () => {
    setPageLoad('start');
    renderWithProviders(<Heading />);
    // Nothing moves focus, so the first Tab reaches the first control of the page: the skip link.
    expect(document.activeElement).toBe(document.body);

    // The next screen comes with a route change and takes focus to its heading.
    cleanup();
    renderWithProviders(<Heading />);
    expect(document.activeElement).toBe(screen.getByTestId('fixture.heading'));
  });

  it('the first screen stays first when its effect runs again', () => {
    setPageLoad('start');
    // Strict mode runs every effect twice on mount; the second run is still the first screen.
    renderWithProviders(
      <StrictMode>
        <Heading />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(document.body);
  });
});
