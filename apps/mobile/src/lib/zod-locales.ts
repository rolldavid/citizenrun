// What `z.locales` holds in the app's bundles: English alone. zod's entry modules re-export every
// locale it ships (`export * as locales`), and Metro bundles each one; metro.config.cjs resolves that
// re-export to this module (D-164). zod registers English itself, from its own `locales/en.js`.
export { default as en } from 'zod/v4/locales/en.js';
