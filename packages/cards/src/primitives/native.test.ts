import { describe, expect, it, vi } from 'vitest';
import type { FontFace } from './types.ts';

// The react-native-svg elements need a React Native runtime; fontAttrs and svgRootProps need none of them.
vi.mock('react-native-svg', () =>
  Object.fromEntries(
    [
      'Circle',
      'ClipPath',
      'Defs',
      'G',
      'Image',
      'LinearGradient',
      'Mask',
      'Path',
      'Rect',
      'Stop',
      'Svg',
      'Text',
      'TSpan',
    ].map((name) => [name, () => null]),
  ),
);

const native = await import('./native.ts');

describe('native primitives', () => {
  it('fontAttrs names each face by its file name and keeps its weight', () => {
    const faces: Record<FontFace, { fontFamily: string; fontWeight: string }> = {
      regular: { fontFamily: 'SpecialGothic-Regular', fontWeight: '400' },
      medium: { fontFamily: 'SpecialGothic-Medium', fontWeight: '500' },
      bold: { fontFamily: 'SpecialGothic-Bold', fontWeight: '700' },
      mono: { fontFamily: 'ChivoMono-Medium', fontWeight: '500' },
    };
    for (const [face, attrs] of Object.entries(faces)) {
      expect(native.fontAttrs(face as FontFace), face).toEqual(attrs); // Object.entries widens the keys to string
    }
  });

  it('svgRootProps hides the canvas from screen readers', () => {
    expect(native.svgRootProps()).toEqual({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  });
});
