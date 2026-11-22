import type { Rule } from 'eslint';
import {
  child,
  children,
  field,
  lastName,
  memberName,
  nameOf,
  report,
  stringValue,
  text,
} from '../ast.ts';
import type { AstNode, Listener } from '../ast.ts';
import { matchesAny, repoRelative } from '../paths.ts';

const PLATFORM_FOLDER = ['apps/mobile/src/platform/**'];
const PLATFORM_MODULES = new Set(['react-native', 'react-native-web']);
const BROWSER_GLOBALS = new Set(['window', 'document', 'navigator']);

/** Only the platform modules may branch on platform (D-033). */
export const noPlatformBranching: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Only apps/mobile/src/platform may branch on the platform.' },
    schema: [],
    messages: {
      platformImport:
        'Platform branching belongs in apps/mobile/src/platform: do not import Platform here; ask a platform module what it supports.',
      platformAccess:
        'Platform branching belongs in apps/mobile/src/platform: do not read Platform here; ask a platform module what it supports.',
      expoOs:
        'Platform branching belongs in apps/mobile/src/platform: do not read process.env.EXPO_OS here.',
      typeofGlobal:
        'Platform branching belongs in apps/mobile/src/platform: do not test typeof {{name}} here.',
    },
  },
  create(context) {
    if (matchesAny(repoRelative(context.filename), PLATFORM_FOLDER)) {
      return {};
    }
    // Local names bound to Platform, and to whole-module imports of the two modules.
    const platformNames = new Set<string>();
    const moduleNames = new Set<string>();

    const listener: Listener = {
      ImportDeclaration(node: AstNode) {
        const source = stringValue(child(node, 'source'));
        if (source === null || !PLATFORM_MODULES.has(source)) {
          return;
        }
        for (const specifier of children(node, 'specifiers')) {
          const local = nameOf(child(specifier, 'local'));
          if (local === null) {
            continue;
          }
          if (specifier.type === 'ImportSpecifier') {
            const imported = child(specifier, 'imported');
            if ((nameOf(imported) ?? stringValue(imported)) === 'Platform') {
              platformNames.add(local);
              report(context, specifier, 'platformImport');
            }
          } else {
            moduleNames.add(local);
          }
        }
      },
      MemberExpression(node: AstNode) {
        const object = child(node, 'object');
        const objectName = nameOf(object);
        if (objectName !== null && platformNames.has(objectName)) {
          report(context, node, 'platformAccess');
          return;
        }
        if (objectName !== null && moduleNames.has(objectName) && memberName(node) === 'Platform') {
          report(context, node, 'platformAccess');
          return;
        }
        if (
          memberName(node) === 'EXPO_OS' &&
          object?.type === 'MemberExpression' &&
          memberName(object) === 'env' &&
          lastName(child(object, 'object')) === 'process'
        ) {
          report(context, node, 'expoOs');
        }
      },
      UnaryExpression(node: AstNode) {
        if (text(node, 'operator') !== 'typeof') {
          return;
        }
        const argument = child(node, 'argument');
        const name = argument?.type === 'Identifier' ? nameOf(argument) : null;
        if (name !== null && BROWSER_GLOBALS.has(name) && field(node, 'prefix') !== false) {
          report(context, node, 'typeofGlobal', { name });
        }
      },
    };
    return listener;
  },
};
