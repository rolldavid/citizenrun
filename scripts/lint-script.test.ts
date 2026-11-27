import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/** The smallest heap, in megabytes, the lint step gives each ESLint run. */
const MIN_ESLINT_HEAP_MB = 4096;

function rootScripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts;
}

/** The `&&`-separated steps of the lint script. */
function lintSteps(): string[] {
  return (rootScripts()['lint'] ?? '').split('&&').map((step) => step.trim());
}

/** The paths each ESLint run names, the last run aside, which lints `.` with ignore patterns. */
function eslintRuns(): string[][] {
  return lintSteps()
    .filter((step) => step.startsWith('eslint '))
    .map((step) =>
      step
        .split(/\s+/)
        .slice(1)
        .filter(
          (word, index, words) => !word.startsWith('-') && !words[index - 1]?.startsWith('-'),
        ),
    );
}

describe('the root lint script', () => {
  it('states a heap for ESLint, keeping any options already set', () => {
    const first = lintSteps()[0] ?? '';
    const heap = /^export NODE_OPTIONS="\$NODE_OPTIONS --max-old-space-size=(\d+)"$/.exec(first);
    expect(heap, `lint must start by exporting a heap for ESLint: ${first}`).not.toBeNull();
    expect(Number(heap?.[1])).toBeGreaterThanOrEqual(MIN_ESLINT_HEAP_MB);
  });

  it('lints in separate runs, each with no warning allowed, so their typed programs do not accumulate', () => {
    const runs = lintSteps().filter((step) => step.startsWith('eslint '));
    expect(runs.length).toBeGreaterThan(1);
    for (const run of runs) {
      expect(run).toMatch(/ --max-warnings 0$/);
    }
  });

  it('still lints the whole repository: the last run is `.` and ignores exactly the earlier runs', () => {
    const runs = lintSteps().filter((step) => step.startsWith('eslint '));
    const last = runs.at(-1) ?? '';
    expect(last).toMatch(/^eslint \. /);
    const ignored = [...last.matchAll(/--ignore-pattern '([^']+)\/\*\*'/g)].map(
      (match) => match[1],
    );
    const earlier = eslintRuns().slice(0, -1).flat();
    expect([...ignored].sort()).toEqual([...earlier].sort());
  });

  it('checks formatting last', () => {
    expect(lintSteps().at(-1)).toBe('prettier --check .');
  });

  it('is the first step of verify', () => {
    expect(rootScripts()['verify']).toMatch(/^pnpm lint && /);
  });
});
