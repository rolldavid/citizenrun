import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ISSUE_IDS } from '@citizenrun/shared';
import { G, Path, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { ISSUE_ICONS } from '../generated/index.ts';
import { IssueIcon, IssueIconSvg } from './issue-icon.tsx';

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function onlyChild(element: Node): Node {
  const children = Children.toArray(element.props.children).filter((child): child is Node =>
    isValidElement(child),
  );
  expect(children).toHaveLength(1);
  const [child] = children;
  if (child === undefined) {
    throw new Error('the element has no child');
  }
  return child;
}

describe('IssueIconSvg', () => {
  it('IssueIconSvg draws the 24 grid at the given size', () => {
    const icon: Node = IssueIconSvg({ id: 'climate', size: 16, fill: 'F' });
    expect(icon.type).toBe(Svg);
    expect(icon.props).toMatchObject({
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      ...svgRootProps(),
    });
    const child = onlyChild(icon);
    expect(child.type).toBe(ISSUE_ICONS.climate);
    expect(child.props).toEqual({ fill: 'F' });
  });

  it('hides the icon from screen readers', () => {
    const icon: Node = IssueIconSvg({ id: 'schools', size: 24, fill: 'F' });
    expect(icon.props).toMatchObject({ 'aria-hidden': true, focusable: 'false' });
  });
});

describe('IssueIcon', () => {
  it('IssueIcon places and scales', () => {
    const icon: Node = IssueIcon({ id: 'schools', x: 10, y: 20, size: 48, fill: 'F' });
    expect(icon.type).toBe(G);
    expect(icon.props.transform).toBe('translate(10 20) scale(2)');
    const child = onlyChild(icon);
    expect(child.type).toBe(ISSUE_ICONS.schools);
    expect(child.props).toEqual({ fill: 'F' });
  });

  it('scales below the grid for a small icon', () => {
    const icon: Node = IssueIcon({ id: 'transit', x: 0, y: 0, size: 12, fill: 'F' });
    expect(icon.props.transform).toBe('translate(0 0) scale(0.5)');
  });
});

describe('ISSUE_ICONS', () => {
  it('every issue has an icon', () => {
    expect(Object.keys(ISSUE_ICONS)).toEqual([...ISSUE_IDS]);
    for (const id of ISSUE_IDS) {
      expect(typeof ISSUE_ICONS[id], id).toBe('function');
    }
  });

  it('each icon draws one-color paths in its fill inside one group', () => {
    for (const id of ISSUE_IDS) {
      const drawing: Node = ISSUE_ICONS[id]({ fill: 'F' });
      expect(drawing.type, id).toBe(G);
      expect(Object.keys(drawing.props), id).toEqual(['children']);
      const paths = Children.toArray(drawing.props.children).filter((child): child is Node =>
        isValidElement(child),
      );
      expect(paths.length, id).toBeGreaterThan(0);
      expect(paths.length, id).toBeLessThanOrEqual(4);
      for (const path of paths) {
        expect(path.type, id).toBe(Path);
        expect(path.props.fill, id).toBe('F');
      }
    }
  });
});
