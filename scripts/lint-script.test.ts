import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/** The smallest heap, in megabytes, ESLint's one typed program over the whole repository is given. */
const MIN_ESLINT_HEAP_MB = 8192;

function rootScripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts;
}

describe('the root lint script', () => {
  it('gives ESLint a stated heap so the typed program does not outgrow the default', () => {
    const lint = rootScripts()['lint'] ?? '';
    const eslintCommand = lint.split('&&')[0]?.trim() ?? '';
    const heap = /^NODE_OPTIONS=--max-old-space-size=(\d+) eslint /.exec(eslintCommand);
    expect(
      heap,
      `lint must start with NODE_OPTIONS=--max-old-space-size=<MB> eslint: ${lint}`,
    ).not.toBeNull();
    expect(Number(heap?.[1])).toBeGreaterThanOrEqual(MIN_ESLINT_HEAP_MB);
  });

  it('still lints the whole repository with no warning allowed, then checks formatting', () => {
    const lint = rootScripts()['lint'] ?? '';
    expect(lint).toMatch(/ eslint \. --max-warnings 0 && prettier --check \.$/);
  });

  it('is the first step of verify', () => {
    expect(rootScripts()['verify']).toMatch(/^pnpm lint && /);
  });
});
