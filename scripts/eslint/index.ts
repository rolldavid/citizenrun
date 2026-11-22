import type { ESLint, Linter } from 'eslint';
import { noBrandLiteral } from './rules/no-brand-literal.ts';
import { noForbiddenLogFields } from './rules/no-forbidden-log-fields.ts';
import { noLiteralText } from './rules/no-literal-text.ts';
import { noPlatformBranching } from './rules/no-platform-branching.ts';
import { noPlatformSuffix } from './rules/no-platform-suffix.ts';
import { noRuleSuppression } from './rules/no-rule-suppression.ts';
import { tokensOnly } from './rules/tokens-only.ts';

const all: Linter.RulesRecord = {
  'citizenrun/no-platform-branching': 'error',
  'citizenrun/no-platform-suffix': 'error',
  'citizenrun/no-literal-text': 'error',
  'citizenrun/tokens-only': 'error',
  'citizenrun/no-forbidden-log-fields': 'error',
  'citizenrun/no-brand-literal': 'error',
  'citizenrun/no-rule-suppression': 'error',
};

/** Test and fixture files may hold text and visual values, and may read untyped test doubles. */
const tests: Linter.RulesRecord = {
  'citizenrun/no-literal-text': 'off',
  'citizenrun/tokens-only': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
};

/** The project's own lint rules. Each rule decides from the file path whether it applies. */
export const citizenrun = {
  meta: { name: 'citizenrun' },
  rules: {
    'no-platform-branching': noPlatformBranching,
    'no-platform-suffix': noPlatformSuffix,
    'no-literal-text': noLiteralText,
    'tokens-only': tokensOnly,
    'no-forbidden-log-fields': noForbiddenLogFields,
    'no-brand-literal': noBrandLiteral,
    'no-rule-suppression': noRuleSuppression,
  },
  configs: { all, tests },
} satisfies ESLint.Plugin & { configs: { all: Linter.RulesRecord; tests: Linter.RulesRecord } };
