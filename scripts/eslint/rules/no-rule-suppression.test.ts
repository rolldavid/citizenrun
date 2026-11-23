import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { citizenrun } from '../index.ts';
import { restrictedNamespacePlugin } from '../restricted-imports.ts';
import { RuleTester, testable } from '../rule-tester.ts';
import { isForbiddenDirective, noRuleSuppression, parseDirective } from './no-rule-suppression.ts';

const FILE = 'packages/shared/src/x.ts';

// The plugins are registered so that each rule a directive names is defined.
const tester = new RuleTester({
  plugins: {
    citizenrun,
    'ri-shared': restrictedNamespacePlugin('shared'),
    '@typescript-eslint': tseslint.plugin,
  },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
});

tester.run('no-rule-suppression', testable(noRuleSuppression), {
  valid: [
    { filename: FILE, code: '// every file runs through eslint\nexport const a = 1;' },
    { filename: FILE, code: '// eslint-enable\nexport const a = 1;' },
    { filename: FILE, code: '/* the build may disable caching */\nexport const a = 1;' },
    { filename: FILE, code: 'export const a = 1;' },
  ],
  invalid: [
    {
      filename: FILE,
      code: '// eslint-disable-next-line @typescript-eslint/no-floating-promises\nexport const a = 1;',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: '// eslint-disable-next-line no-console\nexport const a = 1;',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: '/* eslint-disable no-restricted-properties */\nexport const a = 1;',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: 'export const a = 1; // eslint-disable-line no-restricted-globals, no-restricted-syntax',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: '// eslint-disable-next-line no-console -- with a reason\nexport const a = 1;',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: '// eslint-disable-next-line\nexport const a = 1;',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: 'export const a = 1;\n/* eslint-disable */\nexport const b = 2;',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: 'export const a = 1; // eslint-disable-line citizenrun/tokens-only',
      errors: [{ messageId: 'suppression' }],
    },
    {
      filename: FILE,
      code: "// eslint-disable-next-line no-restricted-imports\nimport 'x';",
      errors: [{ messageId: 'suppression' }],
    },
    {
      filename: FILE,
      code: "// eslint-disable-next-line ri-shared/no-restricted-imports\nimport 'x';",
      errors: [{ messageId: 'suppression' }],
    },
    {
      filename: FILE,
      code: 'export const a = 1;\nexport const b = 2; // eslint-disable-line',
      errors: [{ messageId: 'suppression', line: 1 }],
    },
    {
      filename: FILE,
      code: '/* eslint-disable citizenrun/no-brand-literal */\nexport const a = 1;',
      errors: [{ messageId: 'suppression' }],
    },
  ],
});

describe('parseDirective', () => {
  it('reads the directive kind and the rules it names, without the reason', () => {
    expect(parseDirective(' eslint-disable-next-line a, b/c -- because')).toEqual({
      kind: 'eslint-disable-next-line',
      rules: ['a', 'b/c'],
    });
    expect(parseDirective(' eslint-disable ')).toEqual({ kind: 'eslint-disable', rules: [] });
    expect(parseDirective(' eslint-disable-line -- because')).toEqual({
      kind: 'eslint-disable-line',
      rules: [],
    });
    expect(parseDirective(' eslint-enable')).toBeNull();
    expect(parseDirective(' eslint-disabled for now')).toBeNull();
  });

  it('forbids every directive, whatever it names', () => {
    expect(isForbiddenDirective({ kind: 'eslint-disable', rules: [] })).toBe(true);
    expect(
      isForbiddenDirective({ kind: 'eslint-disable', rules: ['citizenrun/tokens-only'] }),
    ).toBe(true);
    expect(
      isForbiddenDirective({ kind: 'eslint-disable', rules: ['ri-leave/no-restricted-imports'] }),
    ).toBe(true);
    expect(isForbiddenDirective({ kind: 'eslint-disable', rules: ['no-console'] })).toBe(true);
    expect(
      isForbiddenDirective({
        kind: 'eslint-disable-next-line',
        rules: ['@typescript-eslint/no-floating-promises'],
      }),
    ).toBe(true);
    expect(
      isForbiddenDirective({ kind: 'eslint-disable-line', rules: ['no-restricted-properties'] }),
    ).toBe(true);
    for (const value of [
      ' eslint-disable',
      ' eslint-disable no-console',
      ' eslint-disable-line no-restricted-syntax -- because',
      ' eslint-disable-next-line @typescript-eslint/no-explicit-any',
    ]) {
      const directive = parseDirective(value);
      expect(directive).not.toBeNull();
      if (directive !== null) {
        expect(isForbiddenDirective(directive)).toBe(true);
      }
    }
  });
});
