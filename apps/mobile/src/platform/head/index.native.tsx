import type { HeadModule } from './types';

// expo-router/head needs a configured head origin on iOS; phones have no theme-color tag and no
// document title (D-820, D-821).
export const head: HeadModule = {
  ThemeColor: () => null,
  Title: () => null,
};

export type * from './types';
