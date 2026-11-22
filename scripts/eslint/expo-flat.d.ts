// eslint-config-expo ships no type declarations for its flat configuration.
declare module 'eslint-config-expo/flat.js' {
  import type { Linter } from 'eslint';

  const config: Linter.Config[];
  export = config;
}
