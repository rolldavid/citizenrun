import { describe, expect, it } from 'vitest';
import { globToRegExp } from './glob.ts';
import { matchesAny, repoRelative } from './paths.ts';
import { repoRoot } from '../lib/repo-root.ts';

describe('globToRegExp', () => {
  it('matches a double star at the start at any depth, including none', () => {
    const pattern = globToRegExp('**/*.test.ts');
    expect(pattern.test('a/b/c.test.ts')).toBe(true);
    expect(pattern.test('c.test.ts')).toBe(true);
    expect(pattern.test('c.test.tsx')).toBe(false);
  });

  it('matches a trailing double star below its folder only', () => {
    const pattern = globToRegExp('apps/mobile/src/**');
    expect(pattern.test('apps/mobile/src/a/b.ts')).toBe(true);
    expect(pattern.test('apps/mobile/app/a.ts')).toBe(false);
  });

  it('keeps a single star inside one folder', () => {
    expect(globToRegExp('*.ts').test('a/b.ts')).toBe(false);
    expect(globToRegExp('*.ts').test('b.ts')).toBe(true);
    expect(globToRegExp('packages/*/src/**').test('packages/db/src/x.ts')).toBe(true);
    expect(globToRegExp('packages/*/src/**').test('packages/db/extra/src/x.ts')).toBe(false);
  });

  it('matches each choice of a brace group', () => {
    const pattern = globToRegExp('{a,b}.ts');
    expect(pattern.test('a.ts')).toBe(true);
    expect(pattern.test('b.ts')).toBe(true);
    expect(pattern.test('c.ts')).toBe(false);
    expect(globToRegExp('**/*.{ts,tsx}').test('x/y.tsx')).toBe(true);
  });

  it('matches one character with a question mark and escapes dots', () => {
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegExp('a?.ts').test('a/.ts')).toBe(false);
    expect(globToRegExp('a.ts').test('abts')).toBe(false);
  });
});

describe('paths', () => {
  it('makes an absolute path relative to the repository root', () => {
    expect(repoRelative(`${repoRoot()}/apps/mobile/src/a.ts`)).toBe('apps/mobile/src/a.ts');
    expect(repoRelative('apps/mobile/src/a.ts')).toBe('apps/mobile/src/a.ts');
  });

  it('matches a path against any of several globs', () => {
    expect(matchesAny('apps/mobile/src/a.ts', ['packages/**', 'apps/mobile/src/**'])).toBe(true);
    expect(matchesAny('apps/api/src/a.ts', ['packages/**', 'apps/mobile/src/**'])).toBe(false);
  });
});
