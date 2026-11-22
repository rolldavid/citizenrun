import type { Rule } from 'eslint';
import {
  child,
  field,
  keyOf,
  lastName,
  nameOf,
  parentOf,
  report,
  templateParts,
  text,
  unwrap,
} from '../ast.ts';
import type { AstNode, Listener } from '../ast.ts';
import { matchesAny, repoRelative, TEST_GLOBS } from '../paths.ts';

const INCLUDE = [
  'apps/mobile/app/**/*.{ts,tsx}',
  'apps/mobile/src/**/*.{ts,tsx}',
  'packages/cards/src/**/*.{ts,tsx}',
];
const EXCLUDE = ['apps/mobile/app/dev/**', 'apps/mobile/src/features/dev/**', ...TEST_GLOBS];

/** The JSX attributes and object properties whose value reaches the screen. */
export const TEXT_KEYS: ReadonlySet<string> = new Set([
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'aria-description',
  'alt',
  'placeholder',
  'title',
  'label',
  'text',
  'message',
  'description',
  'subtitle',
  'caption',
  'headerTitle',
  'tabBarLabel',
  'confirmLabel',
  'cancelLabel',
  'helperText',
  'errorText',
]);

const LETTER = /\p{L}/u;
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** The literal nodes holding a letter that an expression can evaluate to. */
function literalTexts(expression: AstNode | null): AstNode[] {
  const node = unwrap(expression);
  if (node === null) {
    return [];
  }
  switch (node.type) {
    case 'Literal': {
      const value = field(node, 'value');
      return typeof value === 'string' && LETTER.test(value) ? [node] : [];
    }
    case 'TemplateLiteral':
      return templateParts(node).some((part) => LETTER.test(part)) ? [node] : [];
    case 'ConditionalExpression':
      return [
        ...literalTexts(child(node, 'consequent')),
        ...literalTexts(child(node, 'alternate')),
      ];
    case 'LogicalExpression':
      return [...literalTexts(child(node, 'left')), ...literalTexts(child(node, 'right'))];
    default:
      return [];
  }
}

/** The name a function is known by: its own, or the variable, property or member it is assigned to. */
function functionName(fn: AstNode): string | null {
  const own = nameOf(child(fn, 'id'));
  if (own !== null) {
    return own;
  }
  const parent = parentOf(fn);
  if (parent === null) {
    return null;
  }
  switch (parent.type) {
    case 'VariableDeclarator':
      return nameOf(child(parent, 'id'));
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return keyOf(parent);
    case 'AssignmentExpression':
      return lastName(child(parent, 'left'));
    default:
      return null;
  }
}

function isTextFunction(fn: AstNode): boolean {
  const name = functionName(fn);
  return name !== null && (name === 'altText' || name.endsWith('Text') || name.endsWith('Label'));
}

function enclosingFunction(node: AstNode): AstNode | null {
  let current = parentOf(node);
  while (current !== null && !FUNCTION_TYPES.has(current.type)) {
    current = parentOf(current);
  }
  return current;
}

/** No hard-coded user-facing text in the app and the cards (D-042). */
export const noLiteralText: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'User-facing text goes through the translation layer.' },
    schema: [],
    messages: {
      literalText:
        'User-facing text goes through t() with a catalog key; do not write it as a literal.',
    },
  },
  create(context) {
    const rel = repoRelative(context.filename);
    if (!matchesAny(rel, INCLUDE) || matchesAny(rel, EXCLUDE)) {
      return {};
    }
    const flag = (expression: AstNode | null): void => {
      for (const node of literalTexts(expression)) {
        report(context, node, 'literalText');
      }
    };
    const listener: Listener = {
      JSXText(node: AstNode) {
        if (LETTER.test(text(node, 'value') ?? '')) {
          report(context, node, 'literalText');
        }
      },
      JSXExpressionContainer(node: AstNode) {
        const parent = parentOf(node);
        if (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment') {
          flag(child(node, 'expression'));
        }
      },
      JSXAttribute(node: AstNode) {
        const key = keyOf(node);
        if (key === null || !TEXT_KEYS.has(key)) {
          return;
        }
        const value = child(node, 'value');
        flag(value?.type === 'JSXExpressionContainer' ? child(value, 'expression') : value);
      },
      Property(node: AstNode) {
        const key = keyOf(node);
        if (key !== null && TEXT_KEYS.has(key) && parentOf(node)?.type === 'ObjectExpression') {
          flag(child(node, 'value'));
        }
      },
      ReturnStatement(node: AstNode) {
        const fn = enclosingFunction(node);
        if (fn !== null && isTextFunction(fn)) {
          flag(child(node, 'argument'));
        }
      },
      ArrowFunctionExpression(node: AstNode) {
        const body = child(node, 'body');
        if (body !== null && body.type !== 'BlockStatement' && isTextFunction(node)) {
          flag(body);
        }
      },
    };
    return listener;
  },
};
