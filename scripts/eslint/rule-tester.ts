import type { Rule } from 'eslint';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { field } from './ast.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

export { RuleTester };

type TesterRule = Parameters<RuleTester['run']>[1];

function isTesterRule(value: unknown): value is TesterRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof field(value, 'create') === 'function' &&
    Array.isArray(field(value, 'defaultOptions'))
  );
}

/**
 * A rule in the shape typescript-eslint's tester expects. The rules are typed with ESLint's own
 * rule types; ESLint hands them the same context object either way.
 */
export function testable(rule: Rule.RuleModule): TesterRule {
  const candidate: unknown = { ...rule, defaultOptions: [] };
  if (!isTesterRule(candidate)) {
    throw new Error('not a rule module');
  }
  return candidate;
}

/** A tester that parses TypeScript and JSX and reports no unused disable directives. */
export function ruleTester(): RuleTester {
  return new RuleTester({
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  });
}
