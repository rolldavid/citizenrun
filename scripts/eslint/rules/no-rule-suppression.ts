import type { AST, Rule, SourceCode } from 'eslint';
import { locOf, report } from '../ast.ts';
import type { Listener } from '../ast.ts';

const DIRECTIVE = /^\s*(eslint-disable(?:-line|-next-line)?)(?:\s+([\s\S]*))?$/;

type Comment = ReturnType<SourceCode['getAllComments']>[number];

export type Directive = { kind: string; rules: string[] };

/** The disable directive a comment holds, with the rules it names, or null. */
export function parseDirective(value: string): Directive | null {
  const match = DIRECTIVE.exec(value);
  const kind = match?.[1];
  if (match === null || kind === undefined) {
    return null;
  }
  const list = (match[2] ?? '').split(/\s-{2,}\s|^-{2,}\s|\s-{2,}$/)[0] ?? '';
  const rules = list
    .split(',')
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
  return { kind, rules };
}

/** True when the directive names no rule or a rule that may never be switched off in a file. */
export function isForbiddenDirective(directive: Directive): boolean {
  return (
    directive.rules.length === 0 ||
    directive.rules.some(
      (rule) => rule.startsWith('citizenrun/') || rule.endsWith('no-restricted-imports'),
    )
  );
}

/**
 * Where to report a directive so that the directive itself does not hide the report: a disable
 * that covers this rule hides everything from its own position (a block) or on its own line.
 */
function reportTarget(
  sourceCode: SourceCode,
  comment: Comment,
  directive: Directive,
  ruleId: string,
): Comment | AST.Token {
  const coversThisRule = directive.rules.length === 0 || directive.rules.includes(ruleId);
  if (!coversThisRule || directive.kind === 'eslint-disable-next-line') {
    return comment;
  }
  const line = locOf(comment).start.line;
  let before = sourceCode.getTokenBefore(comment, { includeComments: true });
  if (directive.kind === 'eslint-disable-line') {
    while (before !== null && locOf(before).end.line >= line) {
      before = sourceCode.getTokenBefore(before, { includeComments: true });
    }
  }
  return before ?? comment;
}

/** A rule is never switched off in a file; a rule that is wrong for a file is fixed in its scope. */
export const noRuleSuppression: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disable comments must name a rule, and never a project rule or an import rule.',
    },
    schema: [],
    messages: {
      suppression:
        'Do not switch this rule off in a file: a disable comment must name a rule, and never a citizenrun rule or an import restriction. Fix the rule scope instead.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const listener: Listener = {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const directive = parseDirective(comment.value);
          if (directive !== null && isForbiddenDirective(directive)) {
            report(
              context,
              reportTarget(sourceCode, comment, directive, context.id),
              'suppression',
            );
          }
        }
      },
    };
    return listener;
  },
};
