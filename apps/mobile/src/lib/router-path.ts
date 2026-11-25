import type { Href } from 'expo-router';

/** A string the router accepts as an `Href`. */
export type RouterPath = Extract<Href, string>;

/**
 * Accepts a path built at run time, or one that arrives as a prop, as a router path.
 *
 * With typed routes on, `Href` is the union of the route files' paths, read from the declarations
 * Expo generates into `.expo/types` when the dev server or a web export runs. A clean checkout,
 * as in CI, has no such file, and `Href` is then plain `string | HrefObject`. A type assertion
 * to `Href` is needed in the first state and reported as unnecessary in the second, so the
 * widening is this assertion function, which type-checks and lints the same in both.
 *
 * It checks nothing at run time: the router resolves the path when it navigates.
 */
export function assertRouterPath(path: string): asserts path is RouterPath {
  // Types only: the narrowing is the whole effect.
}
