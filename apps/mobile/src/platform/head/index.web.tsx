import Head from 'expo-router/head';
import type { JSX } from 'react';

import type { HeadModule, ThemeColorProps, TitleProps } from './types';

function ThemeColor({ color }: ThemeColorProps): JSX.Element {
  return (
    <Head>
      <meta name="theme-color" content={color} />
    </Head>
  );
}

function Title({ children }: TitleProps): JSX.Element {
  return (
    <Head>
      <title>{children}</title>
    </Head>
  );
}

export const head: HeadModule = { ThemeColor, Title };

export type * from './types';
