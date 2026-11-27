import { Children, Fragment, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Circle, G, Image, Path, Rect, Svg, Text } from '@citizenrun/cards/primitives';

// What a canvas component draws, read without a renderer: every component is called until only
// primitives are left, so a test sees the elements a target would be handed.

/** One primitive element: its own attributes, what it holds, and its text when it is a line. */
export type Drawn = {
  type: unknown;
  props: Record<string, unknown>;
  children: Drawn[];
  text: string | null;
};

type AnyElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

const PRIMITIVES: ReadonlySet<unknown> = new Set([Svg, G, Path, Rect, Circle, Image, Text]);

/** The primitives under `node`, in drawing order, with fragments and components resolved. */
export function draw(node: ReactNode): Drawn[] {
  return Children.toArray(node).flatMap((child): Drawn[] => {
    if (!isValidElement(child)) {
      return [];
    }
    const element = child as AnyElement;
    if (element.type === Fragment) {
      return draw(element.props.children);
    }
    if (PRIMITIVES.has(element.type)) {
      const { children, ...props } = element.props;
      return [
        {
          type: element.type,
          props,
          children: draw(children),
          text: typeof children === 'string' ? children : null,
        },
      ];
    }
    if (typeof element.type === 'function') {
      const component = element.type as (props: unknown) => ReactNode;
      return draw(component(element.props));
    }
    throw new Error('A canvas holds only primitives and components.');
  });
}

/** Every element of a drawn tree, depth first. */
export function walk(nodes: readonly Drawn[]): Drawn[] {
  return nodes.flatMap((node) => [node, ...walk(node.children)]);
}

/** The lines of text of a drawn tree, in drawing order. */
export function linesOf(nodes: readonly Drawn[]): Drawn[] {
  return walk(nodes).filter((node) => node.type === Text);
}

/** The one line whose text is `text`; throws when there is none or more than one. */
export function lineWith(nodes: readonly Drawn[], text: string): Drawn {
  const found = linesOf(nodes).filter((node) => node.text === text);
  const [line] = found;
  if (line === undefined || found.length !== 1) {
    throw new Error(`Expected one line "${text}", found ${String(found.length)}.`);
  }
  return line;
}
