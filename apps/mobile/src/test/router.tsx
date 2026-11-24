import { cloneElement } from 'react';
import type { JSX, ReactElement } from 'react';

export type TestLinkProps = {
  href: string;
  asChild?: boolean;
  target?: string;
  rel?: string;
  children: ReactElement;
};

/** Stands in for expo-router's Link where no router is mounted: the child renders as a link with the href. */
export function TestLink({ href, target, rel, children }: TestLinkProps): JSX.Element {
  return cloneElement(children, {
    href,
    role: 'link',
    ...(target === undefined ? {} : { hrefAttrs: { target, rel } }),
  } as Record<string, unknown>);
}
