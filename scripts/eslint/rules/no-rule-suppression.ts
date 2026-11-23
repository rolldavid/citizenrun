import type { AST, Rule, SourceCode } from 'eslint';
import { locOf, report } from '../ast.ts';
import type { Listener } from '../ast.ts';

const DIRECTIVE_KINDS: ReadonlySet<string> = new Set([
  'eslint-disable',
  'eslint-disable-line',
  'eslint-disable-next-line',
]);
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

/**
 * True for every directive the parser recognises: no rule is switched off in a file, whatever the
 * directive names or if it names none (D-804).
 */
export function isForbiddenDirective(directive: Directive): boolean {
  return DIRECTIVE_KINDS.has(directive.kind);
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
      description: 'No disable comment: a rule is never switched off in a file.',
    },
    schema: [],
    messages: {
      suppression:
        'Do not switch a rule off in a file: no disable comment is allowed. Fix the code, or fix the rule scope instead.',
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
