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
const svg = await import('react-native-svg');

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

  it('Text draws its line without pair kerning', () => {
    const props = {
      x: 66,
      y: 207.8,
      ...native.fontAttrs('medium'),
      fontSize: 92,
      fill: 'none',
      children: 'Treasurer',
    };
    const line = native.Text(props);
    expect(line.type).toBe(svg.Text);
    expect(line.props).toEqual({ ...props, kerning: 0 });
  });

  it('svgRootProps hides the canvas from screen readers', () => {
    expect(native.svgRootProps()).toEqual({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  });
});
