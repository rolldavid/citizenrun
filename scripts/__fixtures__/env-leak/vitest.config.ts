import { defineConfig } from 'vitest/config';

// A child Vitest run for the repository hygiene test: the shared test environment file must keep
// a key exported in the shell away from the test below (TEST-harness-env).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['leak.fixture.ts'],
    setupFiles: ['../../../vitest.env.ts'],
    environment: 'node',
  },
});
