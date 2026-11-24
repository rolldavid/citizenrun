import { screen } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { HostInstance } from 'react-native';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

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
});
