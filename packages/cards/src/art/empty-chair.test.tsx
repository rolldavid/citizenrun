import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Circle, Rect, Svg } from '@citizenrun/cards/primitives';
import { EmptyChairSvg } from './empty-chair.tsx';

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function childrenOf(element: Node): Node[] {
  return Children.toArray(element.props.children).filter((child): child is Node =>
    isValidElement(child),
  );
}

const ROLES = { ink: 'role-ink', paper: 'role-paper', tone: 'role-tone', spot: 'role-spot' };

describe('EmptyChairSvg', () => {
  it('trimmed leaves out the empty rows above and below the chair', () => {
    const chair: Node = EmptyChairSvg({ width: 200, crop: 'trimmed', ...ROLES });
    expect(chair.type).toBe(Svg);
    expect(chair.props).toMatchObject({ width: 200, height: 175, viewBox: '0 8 96 84' });
  });

  it('trimmed rounds its height to one decimal place', () => {
    const chair: Node = EmptyChairSvg({ width: 100, crop: 'trimmed', ...ROLES });
    expect(chair.props.height).toBe(87.5);
    const odd: Node = EmptyChairSvg({ width: 77, crop: 'trimmed', ...ROLES });
    expect(odd.props.height).toBe(67.4);
  });

  it('whole draws the full square grid', () => {
    const chair: Node = EmptyChairSvg({ width: 96, crop: 'whole', ...ROLES });
    expect(chair.props).toMatchObject({ width: 96, height: 96, viewBox: '0 0 96 96' });
  });

  it('hides the drawing from screen readers', () => {
    const chair: Node = EmptyChairSvg({ width: 200, crop: 'trimmed', ...ROLES });
    expect(chair.props).toMatchObject({
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
  });

  it('draws the six shapes in order, each in the color of its role', () => {
    for (const crop of ['whole', 'trimmed'] as const) {
      const shapes = childrenOf(EmptyChairSvg({ width: 200, crop, ...ROLES }));
      expect(
        shapes.map((shape) => shape.type),
        crop,
      ).toEqual([Circle, Rect, Rect, Rect, Rect, Rect]);
      expect(
        shapes.map((shape) => shape.props),
        crop,
      ).toEqual([
        { cx: 72, cy: 24, r: 14, fill: 'role-tone' },
        { x: 26, y: 16, width: 7, height: 72, fill: 'role-ink' },
        { x: 26, y: 54, width: 38, height: 7, fill: 'role-ink' },
        { x: 57, y: 61, width: 7, height: 27, fill: 'role-ink' },
        { x: 36, y: 45, width: 20, height: 9, fill: 'role-spot' },
        { x: 8, y: 88, width: 80, height: 3, fill: 'role-ink' },
      ]);
    }
  });

  it('draws nothing in the paper color', () => {
    const shapes = childrenOf(EmptyChairSvg({ width: 200, crop: 'trimmed', ...ROLES }));
    expect(shapes.filter((shape) => shape.props.fill === 'role-paper')).toEqual([]);
    expect(shapes).toHaveLength(6);
  });
});
