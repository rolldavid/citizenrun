import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { G, Path, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { OFFICE_ART_IDS, PIN_GLYPHS } from '../generated/index.ts';
import { OfficeGlyph, OfficeGlyphSvg } from './office-glyph.tsx';

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function childrenOf(element: Node): Node[] {
  return Children.toArray(element.props.children).filter((child): child is Node =>
    isValidElement(child),
  );
}

function onlyChild(element: Node): Node {
  const children = childrenOf(element);
  expect(children).toHaveLength(1);
  const [child] = children;
  if (child === undefined) {
    throw new Error('the element has no child');
  }
  return child;
}

describe('OfficeGlyphSvg', () => {
  it('OfficeGlyphSvg draws the 24 grid', () => {
    const glyph: Node = OfficeGlyphSvg({ id: 'sheriff', size: 22, fill: 'F' });
    expect(glyph.type).toBe(Svg);
    expect(glyph.props).toMatchObject({
      width: 22,
      height: 22,
      viewBox: '0 0 24 24',
      ...svgRootProps(),
    });
    const child = onlyChild(glyph);
    expect(child.type).toBe(PIN_GLYPHS.sheriff);
    expect(child.props).toEqual({ fill: 'F' });
  });

  it('an unknown id draws the city council glyph', () => {
    for (const id of ['no-such-drawing', 'constructor', '']) {
      const child = onlyChild(OfficeGlyphSvg({ id, size: 22, fill: 'F' }));
      expect(child.type, id).toBe(PIN_GLYPHS['city-council']);
      expect(child.props, id).toEqual({ fill: 'F' });
    }
    const placed = onlyChild(
      OfficeGlyph({ id: 'no-such-drawing', x: 0, y: 0, size: 24, fill: 'F' }),
    );
    expect(placed.type).toBe(PIN_GLYPHS['city-council']);
  });
});

describe('OfficeGlyph', () => {
  it('OfficeGlyph places and scales', () => {
    const glyph: Node = OfficeGlyph({ id: 'school-board', x: 10, y: 20, size: 48, fill: 'F' });
    expect(glyph.type).toBe(G);
    expect(glyph.props.transform).toBe('translate(10 20) scale(2)');
    const child = onlyChild(glyph);
    expect(child.type).toBe(PIN_GLYPHS['school-board']);
    expect(child.props).toEqual({ fill: 'F' });
  });
});

describe('PIN_GLYPHS', () => {
  it('each glyph draws one-color paths in its fill inside one group', () => {
    for (const id of OFFICE_ART_IDS) {
      const drawing: Node = PIN_GLYPHS[id]({ fill: 'F' });
      expect(drawing.type, id).toBe(G);
      expect(Object.keys(drawing.props), id).toEqual(['children']);
      const paths = childrenOf(drawing);
      expect(paths.length, id).toBeGreaterThan(0);
      expect(paths.length, id).toBeLessThanOrEqual(6);
      for (const path of paths) {
        expect(path.type, id).toBe(Path);
        expect(path.props.fill, id).toBe('F');
      }
    }
  });
});
