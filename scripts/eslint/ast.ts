import type { Rule } from 'eslint';

/**
 * A syntax node as the rules read it. The rules visit TypeScript and JSX nodes that ESLint's
 * ESTree types do not describe, so they read fields through the helpers below.
 */
export type AstNode = { readonly type: string };

/** Visitor functions keyed by node type or selector. */
export type Listener = Record<string, (node: AstNode) => void>;

type Position = { line: number; column: number };
export type Location = { start: Position; end: Position };

/** One field of a node, unchecked. */
export function field(node: object, key: string): unknown {
  return Reflect.get(node, key);
}

export function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof field(value, 'type') === 'string';
}

/** The child node under `key`, or null when it is absent or not a node. */
export function child(node: AstNode, key: string): AstNode | null {
  const value = field(node, key);
  return isAstNode(value) ? value : null;
}

/** The child nodes under `key` (an array field), skipping holes. */
export function children(node: AstNode, key: string): AstNode[] {
  const value = field(node, key);
  return Array.isArray(value) ? value.filter(isAstNode) : [];
}

export function parentOf(node: AstNode): AstNode | null {
  return child(node, 'parent');
}

/** The string field under `key`, or null. */
export function text(node: AstNode, key: string): string | null {
  const value = field(node, key);
  return typeof value === 'string' ? value : null;
}

/** The name of an `Identifier`, `JSXIdentifier` or `PrivateIdentifier`, or null. */
export function nameOf(node: AstNode | null): string | null {
  if (node === null) {
    return null;
  }
  return node.type === 'Identifier' ||
    node.type === 'JSXIdentifier' ||
    node.type === 'PrivateIdentifier'
    ? text(node, 'name')
    : null;
}

/** The string a `Literal` holds, or the text of a template literal without expressions. */
export function stringValue(node: AstNode | null): string | null {
  if (node === null) {
    return null;
  }
  if (node.type === 'Literal') {
    const value = field(node, 'value');
    return typeof value === 'string' ? value : null;
  }
  if (node.type === 'TemplateLiteral' && children(node, 'expressions').length === 0) {
    return templateParts(node).join('');
  }
  return null;
}

/** The cooked text of each part of a template literal. */
export function templateParts(node: AstNode): string[] {
  return children(node, 'quasis').map((quasi) => {
    const value = field(quasi, 'value');
    if (typeof value === 'object' && value !== null) {
      const cooked = field(value, 'cooked');
      if (typeof cooked === 'string') {
        return cooked;
      }
      const raw = field(value, 'raw');
      return typeof raw === 'string' ? raw : '';
    }
    return '';
  });
}

/** The number a numeric `Literal` holds, or null. */
export function numberValue(node: AstNode | null): number | null {
  if (node?.type !== 'Literal') {
    return null;
  }
  const value = field(node, 'value');
  return typeof value === 'number' ? value : null;
}

/** The static name of a property key or member property: an identifier, or a string literal. */
export function staticKey(node: AstNode, computed: boolean): string | null {
  if (!computed) {
    const name = nameOf(node);
    if (name !== null) {
      return name;
    }
  }
  return stringValue(node);
}

/** The key of a `Property` or `MethodDefinition`, or the name of a `JSXAttribute`. */
export function keyOf(node: AstNode): string | null {
  if (node.type === 'JSXAttribute') {
    const name = child(node, 'name');
    if (name?.type === 'JSXNamespacedName') {
      const namespace = nameOf(child(name, 'namespace'));
      const local = nameOf(child(name, 'name'));
      return namespace === null || local === null ? null : `${namespace}:${local}`;
    }
    return nameOf(name);
  }
  const key = child(node, 'key');
  return key === null ? null : staticKey(key, field(node, 'computed') === true);
}

/** The property name of a `MemberExpression`, or null when it is computed from a value. */
export function memberName(node: AstNode): string | null {
  if (node.type !== 'MemberExpression') {
    return null;
  }
  const property = child(node, 'property');
  return property === null ? null : staticKey(property, field(node, 'computed') === true);
}

/** The last name of an identifier or a member chain (`email` for `user.email`), or null. */
export function lastName(node: AstNode | null): string | null {
  if (node === null) {
    return null;
  }
  if (node.type === 'MemberExpression') {
    return memberName(node);
  }
  if (node.type === 'ChainExpression') {
    return lastName(child(node, 'expression'));
  }
  return nameOf(node);
}

/** Removes TypeScript wrappers and parentheses that do not change a value. */
export function unwrap(node: AstNode | null): AstNode | null {
  let current = node;
  while (
    current !== null &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'ChainExpression')
  ) {
    current = child(current, 'expression');
  }
  return current;
}

function isPosition(value: unknown): value is Position {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof field(value, 'line') === 'number' &&
    typeof field(value, 'column') === 'number'
  );
}

/** The source location of a node or comment. */
export function locOf(node: object): Location {
  const loc = field(node, 'loc');
  if (typeof loc === 'object' && loc !== null) {
    const start = field(loc, 'start');
    const end = field(loc, 'end');
    if (isPosition(start) && isPosition(end)) {
      return {
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      };
    }
  }
  return { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
}

/** Reports a problem at a node's location. */
export function report(
  context: Rule.RuleContext,
  node: object,
  messageId: string,
  data?: Record<string, string>,
): void {
  context.report({ loc: locOf(node), messageId, ...(data === undefined ? {} : { data }) });
}
