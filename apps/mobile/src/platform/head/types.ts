import type { ComponentType } from 'react';

export type ThemeColorProps = {
  /** The ground of the current theme (`color.bg`). */
  color: string;
};

export type TitleProps = {
  /** The whole document title, already translated (`common:documentTitle` or a page meta builder's title). */
  children: string;
};

export interface HeadModule {
  /** Web: keeps the document's `theme-color` meta tag equal to `color`. Phones: renders nothing (D-820). */
  ThemeColor: ComponentType<ThemeColorProps>;
  /** Web: keeps the document's title equal to `children`. Phones: renders nothing (D-821). */
  Title: ComponentType<TitleProps>;
}
