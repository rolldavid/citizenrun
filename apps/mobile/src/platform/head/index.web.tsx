import Head from 'expo-router/head';
import type { JSX } from 'react';

import type { HeadModule, ThemeColorProps } from './types';

function ThemeColor({ color }: ThemeColorProps): JSX.Element {
  return (
    <Head>
      <meta name="theme-color" content={color} />
    </Head>
  );
}

export const head: HeadModule = { ThemeColor };

export type * from './types';
