import type { Rule } from 'eslint';
import { isForbiddenLogField } from '@citizenrun/shared';
import {
  child,
  children,
  keyOf,
  lastName,
  memberName,
  nameOf,
  report,
  stringValue,
  text,
  unwrap,
} from '../ast.ts';
import type { AstNode, Listener } from '../ast.ts';
import { matchesAny, repoRelative } from '../paths.ts';

const INCLUDE = [
  'apps/api/src/**',
  'apps/worker/src/**',
  'pipeline/**',
  'packages/*/src/**',
  'scripts/**',
  'apps/mobile/src/**',
];
const LOGGER_METHODS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);
const LOGGER_NAMES: ReadonlySet<string> = new Set(['log', 'logger']);
/** Whole objects that carry forbidden fields. */
const WHOLE_OBJECTS: ReadonlySet<string> = new Set([
  'req',
  'request',
  'headers',
  'body',
  'user',
  'viewer',
  'session',
  'job',
  'payload',
]);

/** True for `<log|logger>.<debug|info|warn|error>(...)`, on an identifier or a property. */
export function isLoggerCall(node: AstNode): boolean {
  const callee = unwrap(child(node, 'callee'));
  if (callee?.type !== 'MemberExpression') {
    return false;
  }
  const method = memberName(callee);
  const objectName = lastName(unwrap(child(callee, 'object')));
  return (
    method !== null &&
    LOGGER_METHODS.has(method) &&
    objectName !== null &&
    LOGGER_NAMES.has(objectName)
  );
}

/** True for `console.<method>(...)` and `<log|logger>.<debug|info|warn|error>(...)`. */
export function isLoggingCall(node: AstNode): boolean {
  const callee = unwrap(child(node, 'callee'));
  if (callee?.type !== 'MemberExpression') {
    return false;
  }
  return nameOf(unwrap(child(callee, 'object'))) === 'console' || isLoggerCall(node);
}

/** Logs never carry tokens, emails, coordinates, addresses, message bodies or typed text (INV-36). */
export const noForbiddenLogFields: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Logging calls never carry a forbidden field.' },
    schema: [],
    messages: {
      field:
        'Do not log the field {{name}}: it may hold private data. Log a code or an id instead.',
      whole:
        'Do not log the whole {{name}} object: it carries private fields. Log the fields you need.',
      interpolated:
        'Do not put {{name}} into a log message: it may hold private data. Log a code or an id instead.',
      event:
        'The first argument of a logger call is its event and must be fixed in the source: use a string literal or a template literal without expressions, and log the changing parts as named fields.',
    },
  },
  create(context) {
    if (!matchesAny(repoRelative(context.filename), INCLUDE)) {
      return {};
    }

    const checkInterpolated = (node: AstNode): void => {
      const name = lastName(unwrap(node));
      if (name !== null && isForbiddenLogField(name)) {
        report(context, node, 'interpolated', { name });
        return;
      }
      visitText(node);
    };

    // Template literals and string concatenations: report what they interpolate.
    const visitText = (node: AstNode): void => {
      const inner = unwrap(node);
      if (inner?.type === 'TemplateLiteral') {
        for (const expression of children(inner, 'expressions')) {
          checkInterpolated(expression);
        }
      } else if (inner?.type === 'BinaryExpression' && text(inner, 'operator') === '+') {
        for (const side of [child(inner, 'left'), child(inner, 'right')]) {
          if (side !== null) {
            checkInterpolated(side);
          }
        }
      }
    };

    const checkWhole = (node: AstNode): boolean => {
      const name = lastName(unwrap(node));
      if (name !== null && WHOLE_OBJECTS.has(name)) {
        report(context, node, 'whole', { name });
        return true;
      }
      return false;
    };

    const visitValue = (node: AstNode | null): void => {
      const inner = unwrap(node);
      if (inner === null) {
        return;
      }
      switch (inner.type) {
        case 'Identifier':
          checkWhole(inner);
          return;
        case 'SpreadElement': {
          const argument = child(inner, 'argument');
          if (argument !== null && !checkWhole(argument)) {
            visitValue(argument);
          }
          return;
        }
        case 'ObjectExpression':
          for (const property of children(inner, 'properties')) {
            if (property.type === 'Property') {
              const key = keyOf(property);
              if (key !== null && isForbiddenLogField(key)) {
                report(context, property, 'field', { name: key });
                continue;
              }
              visitValue(child(property, 'value'));
            } else {
              visitValue(property);
            }
          }
          return;
        case 'ArrayExpression':
          for (const element of children(inner, 'elements')) {
            visitValue(element);
          }
          return;
        case 'TemplateLiteral':
        case 'BinaryExpression':
          visitText(inner);
          return;
        case 'ConditionalExpression':
          visitValue(child(inner, 'consequent'));
          visitValue(child(inner, 'alternate'));
          return;
        case 'LogicalExpression':
          visitValue(child(inner, 'left'));
          visitValue(child(inner, 'right'));
          return;
        default:
          return;
      }
    };

    const listener: Listener = {
      CallExpression(node: AstNode) {
        if (!isLoggingCall(node)) {
          return;
        }
        const args = children(node, 'arguments');
        if (isLoggerCall(node)) {
          const first = args[0];
          if (first === undefined || stringValue(unwrap(first)) === null) {
            report(context, first ?? node, 'event');
          }
        }
        for (const argument of args) {
          visitValue(argument);
        }
      },
    };
    return listener;
  },
};
