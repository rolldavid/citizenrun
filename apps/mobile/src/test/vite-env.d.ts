// Types for the two Vite features the app's tests use: import.meta.glob of raw text, and ?raw imports.
interface ImportMeta {
  glob<T = string>(
    patterns: string | readonly string[],
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, T>;
}

declare module '*?raw' {
  const source: string;
  export { source as default };
}
