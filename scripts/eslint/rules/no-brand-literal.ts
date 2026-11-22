import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rule } from 'eslint';
import { BrandSchema } from '../../gen-brand.ts';
import type { Brand } from '../../gen-brand.ts';
import { repoRoot } from '../../lib/repo-root.ts';
import { field, parentOf, report, templateParts, text } from '../ast.ts';
import type { AstNode, Listener } from '../ast.ts';
import { repoRelative } from '../paths.ts';

/** The one file that writes brand values: the generator of the brand module. */
const GENERATOR = 'scripts/gen-brand.ts';
/** Internal protocol names that are never reported (D-016). */
const PROTOCOL_NAMES = ['X-OS-Client', 'os_session', 'os_events'] as const;
const IMPORT_PARENTS: ReadonlySet<string> = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
  'TSExternalModuleReference',
  'TSImportType',
  'TSLiteralType',
]);

/**
 * Every string no file may write: each display name, bundle id and Android package; the domain
 * and each host when set, with the hosts derived from them; each scheme followed by `://`.
 */
export function brandForbiddenStrings(brand: Brand): string[] {
  const found = new Set<string>([brand.displayName]);
  if (brand.domain !== null) {
    found.add(brand.domain);
    found.add(`mail.${brand.domain}`);
  }
  for (const variant of Object.values(brand.variants)) {
    found.add(variant.displayName);
    found.add(variant.iosBundleId);
    found.add(variant.androidPackage);
    found.add(`${variant.scheme}://`);
    if (variant.host !== null) {
      found.add(variant.host);
      found.add(`go.${variant.host}`);
    }
    if (variant.adminHost !== null) {
      found.add(variant.adminHost);
    }
  }
  return [...found];
}

/** The forbidden strings of the repository's brand.json, read once. */
export const BRAND_FORBIDDEN: readonly string[] = brandForbiddenStrings(
  BrandSchema.parse(JSON.parse(readFileSync(join(repoRoot(), 'brand.json'), 'utf8'))),
);

/** The forbidden string a text contains, or null; the protocol names are left out first. */
export function brandStringIn(value: string, forbidden: readonly string[]): string | null {
  let checked = value;
  for (const name of PROTOCOL_NAMES) {
    checked = checked.split(name).join(' ');
  }
  return forbidden.find((item) => checked.includes(item)) ?? null;
}

function isImportSource(node: AstNode): boolean {
  const parent = parentOf(node);
  if (parent === null || !IMPORT_PARENTS.has(parent.type)) {
    return false;
  }
  // A literal type is a module path only inside an import type: `import('x')`.
  return parent.type !== 'TSLiteralType' || parentOf(parent)?.type === 'TSImportType';
}

/** Brand identifiers come only from the brand module (D-016). */
export const noBrandLiteral: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Brand identifiers come from the brand module.' },
    schema: [],
    messages: {
      brand:
        'Read brand identifiers from the brand module (BRAND of @citizenrun/shared); do not write "{{value}}" here.',
    },
  },
  create(context) {
    if (repoRelative(context.filename) === GENERATOR) {
      return {};
    }
    const check = (node: AstNode, value: string): void => {
      const found = brandStringIn(value, BRAND_FORBIDDEN);
      if (found !== null) {
        report(context, node, 'brand', { value: found });
      }
    };
    const listener: Listener = {
      Literal(node: AstNode) {
        const value = field(node, 'value');
        if (typeof value === 'string' && !isImportSource(node)) {
          check(node, value);
        }
      },
      TemplateLiteral(node: AstNode) {
        for (const part of templateParts(node)) {
          check(node, part);
        }
      },
      JSXText(node: AstNode) {
        check(node, text(node, 'value') ?? '');
      },
    };
    return listener;
  },
};
