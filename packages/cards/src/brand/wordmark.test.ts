import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { BRAND } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { Path, Svg } from '@citizenrun/cards/primitives';
import { MONOGRAM, WORDMARK, WORDMARK_SOURCE_TEXT, WordmarkSvg } from './wordmark.ts';

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function childrenOf(element: Node): Node[] {
  return Children.toArray(element.props.children).filter((child): child is Node =>
    isValidElement(child),
  );
}

/** The commands of an outline: absolute moves, lines, quadratic curves and closes only. */
const OUTLINE = /^(?:[MLHVQ]-?\d+(?:\.\d+)?(?:[ ]-?\d+(?:\.\d+)?)*|Z)+$/;

describe('wordmark', () => {
  it('wordmark matches the brand', () => {
    expect(
      String.fromCodePoint(...WORDMARK_SOURCE_TEXT),
      "The wordmark outlines were made from another name; regenerate them from the brand's display name",
    ).toBe(BRAND.displayName);
  });

  it('the outlines have the sizes they were typeset at', () => {
    expect(WORDMARK.width).toBe(6249);
    expect(WORDMARK.height).toBe(710);
    expect(MONOGRAM.width).toBe(1685);
    expect(MONOGRAM.height).toBe(710);
  });

  it('the outlines are the ones that were typeset', () => {
    expect(WORDMARK.d.startsWith('M471 723Q343 723')).toBe(true);
    expect(WORDMARK.d).toHaveLength(2124);
    expect(MONOGRAM.d.startsWith('M471 723Q343 723')).toBe(true);
    expect(MONOGRAM.d).toHaveLength(625);
    expect(WORDMARK.d.endsWith('V710Z')).toBe(true);
  });

  it('the outlines hold absolute commands only, one closed shape after another', () => {
    expect(WORDMARK.d).toMatch(OUTLINE);
    expect(MONOGRAM.d).toMatch(OUTLINE);
    expect(WORDMARK.d.split('M')).toHaveLength(15);
    expect(MONOGRAM.d.split('M')).toHaveLength(4);
  });

  it('the two letters open the name', () => {
    const firstShape = WORDMARK.d.slice(0, WORDMARK.d.indexOf('Z') + 1);
    expect(MONOGRAM.d.startsWith(firstShape)).toBe(true);
  });
});

describe('WordmarkSvg', () => {
  it('draws the name at a cap height, its width rounded to one decimal place', () => {
    const mark: Node = WordmarkSvg({ variant: 'wordmark', capHeight: 17, fill: '#141412' });
    expect(mark.type).toBe(Svg);
    expect(mark.props).toMatchObject({ width: 149.6, height: 17, viewBox: '0 0 6249 710' });
  });

  it('draws the two letters at a cap height', () => {
    const mark: Node = WordmarkSvg({ variant: 'monogram', capHeight: 20, fill: '#141412' });
    expect(mark.props).toMatchObject({ width: 47.5, height: 20, viewBox: '0 0 1685 710' });
  });

  it('draws one path in the fill it is given and hides it from screen readers', () => {
    for (const variant of ['wordmark', 'monogram'] as const) {
      const mark: Node = WordmarkSvg({ variant, capHeight: 44, fill: 'a-fill' });
      expect(mark.props, variant).toMatchObject({
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
        focusable: 'false',
      });
      const shapes = childrenOf(mark);
      expect(shapes, variant).toHaveLength(1);
      expect(shapes[0]?.type, variant).toBe(Path);
      expect(shapes[0]?.props, variant).toEqual({
        d: variant === 'wordmark' ? WORDMARK.d : MONOGRAM.d,
        fill: 'a-fill',
      });
    }
  });
});
