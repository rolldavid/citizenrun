import type { HeadModule } from './types';

// expo-router/head needs a configured head origin on iOS; phones have no theme-color tag (D-820).
export const head: HeadModule = {
  ThemeColor: () => null,
};

export type * from './types';
