// The first setup file of every Vitest project (D-560, TEST-harness-env). Before any test file is
// imported it removes every variable the shell exported except this allow-list, so a key set in a
// developer's shell never reaches a test and every suite runs with no owner input present.
const KEPT_NAMES = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'TZ',
  'LANG',
  'CI',
  'NODE_ENV',
  'NODE_OPTIONS',
  'UPDATE_GOLDEN',
]);
const KEPT_PREFIXES = ['VITEST', 'TEST_', 'npm_'];

for (const name of Object.keys(process.env)) {
  if (KEPT_NAMES.has(name) || KEPT_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    continue;
  }
  delete process.env[name];
}
