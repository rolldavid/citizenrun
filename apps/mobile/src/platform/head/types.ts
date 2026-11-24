import type { ComponentType } from 'react';

export type ThemeColorProps = {
  /** The ground of the current theme (`color.bg`). */
  color: string;
};

export interface HeadModule {
  /** Web: keeps the document's `theme-color` meta tag equal to `color`. Phones: renders nothing (D-820). */
  ThemeColor: ComponentType<ThemeColorProps>;
}
