import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

// The setup file replaces expo-router/head with a component that renders nothing; here it renders its children
// in place, so the tag the web file asks for can be read.
vi.mock('expo-router/head', () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

function themeColorMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="theme-color"]');
}

function titleElement(): HTMLTitleElement | null {
  return document.querySelector('title');
}

describe('head', () => {
  it('both files export the same members', () => {
    expect(Object.keys(native.head).sort()).toEqual(['ThemeColor', 'Title']);
    expect(Object.keys(web.head).sort()).toEqual(['ThemeColor', 'Title']);
  });

  it('the web file sets the theme-color meta tag and follows its color', () => {
    const { ThemeColor } = web.head;
    const view = render(<ThemeColor color="#F1EFE7" />);
    expect(themeColorMeta()?.getAttribute('content')).toBe('#F1EFE7');
    view.rerender(<ThemeColor color="#121210" />);
    expect(themeColorMeta()?.getAttribute('content')).toBe('#121210');
    view.unmount();
    expect(themeColorMeta()).toBeNull();
  });

  it('the web file sets the document title and follows its text', () => {
    const { Title } = web.head;
    const view = render(<Title>Status · Fixture</Title>);
    expect(titleElement()?.textContent).toBe('Status · Fixture');
    view.rerender(<Title>Sign in · Fixture</Title>);
    expect(titleElement()?.textContent).toBe('Sign in · Fixture');
    view.unmount();
    expect(titleElement()).toBeNull();
  });

  it('the phone file renders nothing', () => {
    const { ThemeColor, Title } = native.head;
    const view = render(
      <>
        <ThemeColor color="#F1EFE7" />
        <Title>Status · Fixture</Title>
      </>,
    );
    expect(view.container.childNodes).toHaveLength(0);
    expect(themeColorMeta()).toBeNull();
    expect(titleElement()).toBeNull();
    view.unmount();
  });
});
