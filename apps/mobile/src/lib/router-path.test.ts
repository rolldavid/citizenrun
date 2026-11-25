import type { Href } from 'expo-router';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { assertRouterPath } from './router-path';

describe('assertRouterPath', () => {
  it('accepts an in-app path and an outside URL without checking them at run time', () => {
    expect(() => {
      assertRouterPath('/settings/account');
    }).not.toThrow();
    expect(() => {
      assertRouterPath('https://example.org/');
    }).not.toThrow();
  });

  it('narrows a string built at run time to a value the router accepts', () => {
    const path = ['', 'settings'].join('/');
    assertRouterPath(path);
    expectTypeOf(path).toExtend<Href>();
  });
});
