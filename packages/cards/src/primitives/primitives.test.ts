import type { JSXElementConstructor } from 'react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as dom from './dom.ts';
import type * as native from './native.ts';
import type { FontFace } from './types.ts';

const TAGS = {
  Svg: 'svg',
  G: 'g',
  Path: 'path',
  Rect: 'rect',
  Circle: 'circle',
  Defs: 'defs',
  LinearGradient: 'linearGradient',
  Stop: 'stop',
  ClipPath: 'clipPath',
  Mask: 'mask',
  Image: 'image',
  Text: 'text',
  TSpan: 'tspan',
} as const;

/** The props a primitive takes; a helper stays as it is. */
type Takes<C> = C extends JSXElementConstructor<infer P> ? P : C;

describe('primitives', () => {
  it('dom.ts exports the thirteen primitives and the two helpers, and nothing else', () => {
    expect(Object.keys(dom).sort()).toEqual(
      [...Object.keys(TAGS), 'fontAttrs', 'svgRootProps'].sort(),
    );
    expect(Object.keys(TAGS)).toHaveLength(13);
  });

  it('native.ts exports the same names with the same props as dom.ts', () => {
    expectTypeOf<keyof typeof native>().toEqualTypeOf<keyof typeof dom>();
    expectTypeOf<Takes<typeof native.Svg>>().toEqualTypeOf<Takes<typeof dom.Svg>>();
    expectTypeOf<Takes<typeof native.G>>().toEqualTypeOf<Takes<typeof dom.G>>();
    expectTypeOf<Takes<typeof native.Path>>().toEqualTypeOf<Takes<typeof dom.Path>>();
    expectTypeOf<Takes<typeof native.Rect>>().toEqualTypeOf<Takes<typeof dom.Rect>>();
    expectTypeOf<Takes<typeof native.Circle>>().toEqualTypeOf<Takes<typeof dom.Circle>>();
    expectTypeOf<Takes<typeof native.Defs>>().toEqualTypeOf<Takes<typeof dom.Defs>>();
    expectTypeOf<Takes<typeof native.LinearGradient>>().toEqualTypeOf<
      Takes<typeof dom.LinearGradient>
    >();
    expectTypeOf<Takes<typeof native.Stop>>().toEqualTypeOf<Takes<typeof dom.Stop>>();
    expectTypeOf<Takes<typeof native.ClipPath>>().toEqualTypeOf<Takes<typeof dom.ClipPath>>();
    expectTypeOf<Takes<typeof native.Mask>>().toEqualTypeOf<Takes<typeof dom.Mask>>();
    expectTypeOf<Takes<typeof native.Image>>().toEqualTypeOf<Takes<typeof dom.Image>>();
    expectTypeOf<Takes<typeof native.Text>>().toEqualTypeOf<Takes<typeof dom.Text>>();
    expectTypeOf<Takes<typeof native.TSpan>>().toEqualTypeOf<Takes<typeof dom.TSpan>>();
    expectTypeOf<Takes<typeof native.fontAttrs>>().toEqualTypeOf<Takes<typeof dom.fontAttrs>>();
    expectTypeOf<ReturnType<typeof native.svgRootProps>>().toEqualTypeOf<
      ReturnType<typeof dom.svgRootProps>
    >();
  });

  it('each primitive returns its lowercase SVG element', () => {
    const drawn: Record<keyof typeof TAGS, { type: unknown }> = {
      Svg: dom.Svg({ width: 10, height: 10, viewBox: '0 0 10 10' }),
      G: dom.G({}),
      Path: dom.Path({ d: 'M0 0h1v1z', fill: 'none' }),
      Rect: dom.Rect({ x: 0, y: 0, width: 1, height: 1, fill: 'none' }),
      Circle: dom.Circle({ cx: 0, cy: 0, r: 1, fill: 'none' }),
      Defs: dom.Defs({ children: null }),
      LinearGradient: dom.LinearGradient({ id: 'a', x1: 0, y1: 0, x2: 1, y2: 0, children: null }),
      Stop: dom.Stop({ offset: 0, stopColor: 'none' }),
      ClipPath: dom.ClipPath({ id: 'a', children: null }),
      Mask: dom.Mask({ id: 'a', children: null }),
      Image: dom.Image({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        href: 'data:image/jpeg;base64,',
        preserveAspectRatio: 'xMidYMid slice',
      }),
      Text: dom.Text({
        x: 0,
        y: 0,
        fontFamily: 'Chivo Mono',
        fontSize: 40,
        fill: 'none',
        children: 'a',
      }),
      TSpan: dom.TSpan({ children: 'a' }),
    };
    expect(
      Object.fromEntries(Object.entries(drawn).map(([name, made]) => [name, made.type])),
    ).toEqual(TAGS);
    expect(drawn.LinearGradient.type).toBe('linearGradient');
    expect(drawn.ClipPath.type).toBe('clipPath');
  });

  it('a primitive passes its props to the element unchanged', () => {
    const props = {
      x: 66,
      y: 690,
      width: 340,
      height: 72,
      fill: '#D9F23E',
      stroke: '#141412',
      strokeWidth: 3,
      transform: 'rotate(-3 236 726)',
    };
    expect(dom.Rect(props).props).toEqual(props);

    const root = dom.Svg({
      width: 540,
      height: 675,
      viewBox: '0 0 1080 1350',
      ...dom.svgRootProps(),
    });
    expect(root.props).toEqual({
      width: 540,
      height: 675,
      viewBox: '0 0 1080 1350',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
  });

  it('Text is written without pair kerning, and takes it off on the web from CSS', () => {
    const line = dom.Text({
      x: 66,
      y: 207.8,
      fontFamily: 'Special Gothic',
      fontWeight: '500',
      fontSize: 92,
      fill: 'none',
      children: 'Treasurer',
    });
    // A ref is one of an element's props.
    const { ref, ...written } = line.props as { ref: (text: unknown) => void } & Record<
      string,
      unknown
    >;
    expect(written).toEqual({
      x: 66,
      y: 207.8,
      fontFamily: 'Special Gothic',
      fontWeight: '500',
      fontSize: 92,
      fill: 'none',
      children: 'Treasurer',
      kerning: 0,
    });

    const set: [string, string][] = [];
    ref({
      style: {
        setProperty: (name: string, value: string) => {
          set.push([name, value]);
        },
      },
    });
    expect(set).toEqual([['font-kerning', 'none']]);
    expect(() => {
      ref(null);
    }).not.toThrow();
  });

  it('fontAttrs names each face by its family and weight', () => {
    const faces: Record<FontFace, { fontFamily: string; fontWeight: string }> = {
      regular: { fontFamily: 'Special Gothic', fontWeight: '400' },
      medium: { fontFamily: 'Special Gothic', fontWeight: '500' },
      bold: { fontFamily: 'Special Gothic', fontWeight: '700' },
      mono: { fontFamily: 'Chivo Mono', fontWeight: '500' },
    };
    for (const [face, attrs] of Object.entries(faces)) {
      expect(dom.fontAttrs(face as FontFace), face).toEqual(attrs); // Object.entries widens the keys to string
    }
  });

  it('svgRootProps names the namespace and hides the canvas from screen readers', () => {
    expect(dom.svgRootProps()).toEqual({
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
  });
});
