import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import { ERROR_CODES } from '@citizenrun/shared';
import { BRAND_FORBIDDEN, brandStringIn } from './eslint/rules/no-brand-literal.ts';
import { repoRoot } from './lib/repo-root.ts';

/** Catalog values by namespace, each flattened to dot-path keys. */
export type Catalogs = Map<string, Map<string, string>>;

/** One literal key read in code. `namespace` is null when the key falls to the default namespace. */
export type Use = {
  file: string;
  line: number;
  namespace: string | null;
  key: string;
  options: readonly string[];
};

export type ProblemKind =
  | 'undefined-key'
  | 'unused-key'
  | 'plural-pair'
  | 'key-shape'
  | 'namespace'
  | 'missing-error-key'
  | 'interpolation'
  | 'brand'
  | 'advocacy'
  | 'caution';

export type Problem = { kind: ProblemKind; detail: string };

export type SourceText = { path: string; text: string };

const CATALOG_DIR = 'packages/shared/src/i18n/en';
const DYNAMIC_KEYS_FILE = 'packages/shared/src/i18n/dynamic-keys.ts';
const FEATURES_DIR = 'apps/mobile/src/features';
const SCAN_ROOTS = ['apps', 'packages', 'pipeline'];
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.expo',
  'ios',
  'android',
]);
// The generated folders and the catalogs.
const SKIPPED_PATHS: ReadonlySet<string> = new Set([
  'packages/shared/src/api',
  'packages/cards/src/generated',
  CATALOG_DIR,
]);

const DEFAULT_NAMESPACE = 'common';
const FIXED_NAMESPACES: ReadonlySet<string> = new Set([
  'common',
  'errors',
  'cards',
  'notifications',
  'native',
]);
/** Option names that are not interpolated into the text. */
const NON_INTERPOLATED: ReadonlySet<string> = new Set([
  'count',
  'ns',
  'lng',
  'defaultValue',
  'context',
  'ordinal',
  'returnObjects',
  'appName',
]);
const PLURAL = /_(?:one|other)$/;
const SEGMENT = /^[a-z][a-zA-Z0-9]*$/;
const LAST_SEGMENT = /^[a-z][a-zA-Z0-9]*(?:_about)?(?:_one|_other)?$/;
const MAX_SEGMENTS = 3;

/** The catalogs whose values may never urge a vote about a person (INV-28, D-356). */
export const ADVOCACY_SCAN_NAMESPACES = ['cards', 'notifications'] as const;
/** The words of express advocacy, whole words in any case: "re-elect" counts, "election" does not. */
const ADVOCACY_WORDS = /\b(vote for|vote against|elect|defeat)\b/i;
/** The one caution sentence, under its one key (D-515). */
const CAUTION_KEY = 'common:confirmBeforeFiling';
const CAUTION_SENTENCE = 'Confirm with your election office.';
const CAUTION_PHRASE = 'confirm with your election office';
/** The keys that may hold the caution inside a longer sentence. */
const CAUTION_SENTENCE_PREFIXES: readonly string[] = ['common:ui.closing.'];
const CAUTION_SENTENCE_KEYS: ReadonlySet<string> = new Set(['forms:packetNotice']);
/** The keys that hold the caution itself, in an email, and must equal it exactly. */
const CAUTION_EXACT_KEYS: ReadonlySet<string> = new Set([
  CAUTION_KEY,
  'notifications:emailDeadlineReminder.caution',
  'notifications:emailDeadlineChanged.caution',
]);

/** The express-advocacy words in the scanned catalogs; each problem names the key and the word. */
function advocacyProblems(catalogs: Catalogs): Problem[] {
  const problems: Problem[] = [];
  for (const namespace of ADVOCACY_SCAN_NAMESPACES) {
    for (const [key, value] of catalogs.get(namespace) ?? []) {
      const found = ADVOCACY_WORDS.exec(value);
      if (found !== null) {
        problems.push({
          kind: 'advocacy',
          detail: `${namespace}:${key} uses the words "${(found[1] ?? '').toLowerCase()}" (D-356)`,
        });
      }
    }
  }
  return problems;
}

/** The caution sentence exists once, exactly, and no other wording of it is in any catalog. */
function cautionProblems(catalogs: Catalogs): Problem[] {
  const problems: Problem[] = [];
  if (catalogs.get('common')?.get('confirmBeforeFiling') === undefined) {
    problems.push({ kind: 'caution', detail: `${CAUTION_KEY} is missing (D-515)` });
  }
  for (const [namespace, catalog] of catalogs) {
    for (const [key, value] of catalog) {
      const id = `${namespace}:${key}`;
      if (CAUTION_EXACT_KEYS.has(id)) {
        if (value !== CAUTION_SENTENCE) {
          problems.push({
            kind: 'caution',
            detail: `${id} must be exactly "${CAUTION_SENTENCE}" (D-515)`,
          });
        }
        continue;
      }
      const allowed =
        CAUTION_SENTENCE_KEYS.has(id) ||
        CAUTION_SENTENCE_PREFIXES.some((prefix) => id.startsWith(prefix));
      if (!allowed && value.toLowerCase().includes(CAUTION_PHRASE)) {
        problems.push({
          kind: 'caution',
          detail: `${id} words the caution again; read ${CAUTION_KEY} (D-515)`,
        });
      }
    }
  }
  return problems;
}

/** Flattens a catalog object to dot-path keys and their string values. */
export function flattenCatalog(value: object, prefix = ''): Map<string, string> {
  const found = new Map<string, string>();
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, inner] of entries) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof inner === 'string') {
      found.set(path, inner);
    } else if (typeof inner === 'object' && inner !== null) {
      for (const [innerKey, innerValue] of flattenCatalog(inner, path)) {
        found.set(innerKey, innerValue);
      }
    }
  }
  return found;
}

/** Catalogs from plain objects, keyed by namespace. */
export function catalogsFrom(record: Readonly<Record<string, object>>): Catalogs {
  return new Map(
    Object.entries(record).map(([namespace, value]) => [namespace, flattenCatalog(value)]),
  );
}

/** Loads every catalog file under the catalog folder; the namespace is the file name. */
export async function loadCatalogs(root: string): Promise<Catalogs> {
  const catalogs: Catalogs = new Map();
  const dir = join(root, CATALOG_DIR);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  for (const name of files) {
    const namespace = name.slice(0, -'.ts'.length);
    const loaded: unknown = await import(pathToFileURL(join(dir, name)).href);
    const exported: unknown =
      typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, namespace) : null;
    catalogs.set(
      namespace,
      typeof exported === 'object' && exported !== null
        ? flattenCatalog(exported)
        : new Map<string, string>(),
    );
  }
  return catalogs;
}

const DynamicKeysSchema = z.object({
  DYNAMIC_KEYS: z.array(z.object({ key: z.string(), reason: z.string() })),
});

async function loadDynamicKeys(root: string): Promise<string[]> {
  const loaded: unknown = await import(pathToFileURL(join(root, DYNAMIC_KEYS_FILE)).href);
  return DynamicKeysSchema.parse(loaded).DYNAMIC_KEYS.map((entry) => entry.key);
}

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every `.ts` and `.tsx` file under apps, packages and pipeline, without generated folders. */
export function listSourceFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = relative(root, path).split(sep).join('/');
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) && !SKIPPED_PATHS.has(rel)) {
          visit(path);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(rel);
      }
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    visit(join(root, scanRoot));
  }
  return found.sort();
}

function literalText(node: ts.Node | undefined): string | null {
  if (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

/** The option names of an object literal, and the namespace its `ns` option names. */
function readOptions(node: ts.Expression | undefined): {
  names: string[];
  namespace: string | null;
} {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) {
    return { names: [], namespace: null };
  }
  const names: string[] = [];
  let namespace: string | null = null;
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      names.push(property.name.text);
    } else if (ts.isPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      if (name !== null) {
        names.push(name);
        if (name === 'ns') {
          namespace = literalText(property.initializer);
        }
      }
    }
  }
  return { names, namespace };
}

function isTranslateCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

function splitKey(written: string): { namespace: string | null; key: string } {
  const colon = written.indexOf(':');
  return colon === -1
    ? { namespace: null, key: written }
    : { namespace: written.slice(0, colon), key: written.slice(colon + 1) };
}

/**
 * The literal keys each file reads: the first argument of `t(...)` and `<anything>.t(...)`, and
 * `i18nKey` attributes, in the file's `useTranslation('<namespace>')` namespace when unprefixed.
 */
export function collectUses(files: readonly SourceText[]): Use[] {
  const uses: Use[] = [];
  for (const file of files) {
    const kind = file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, kind);
    let fileNamespace: string | null = null;
    const found: {
      written: string;
      node: ts.Node;
      options: string[];
      optionNamespace: string | null;
    }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === 'useTranslation' && fileNamespace === null) {
          const first = node.arguments[0];
          fileNamespace =
            first !== undefined && ts.isArrayLiteralExpression(first)
              ? literalText(first.elements[0])
              : literalText(first);
        } else if (isTranslateCall(node)) {
          const written = literalText(node.arguments[0]);
          if (written !== null) {
            const objectArgument = node.arguments
              .slice(1, 3)
              .find((argument) => ts.isObjectLiteralExpression(argument));
            const options = readOptions(objectArgument);
            found.push({
              written,
              node,
              options: options.names,
              optionNamespace: options.namespace,
            });
          }
        }
      } else if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'i18nKey'
      ) {
        const initializer = node.initializer;
        const written =
          initializer !== undefined && ts.isJsxExpression(initializer)
            ? literalText(initializer.expression)
            : literalText(initializer);
        if (written !== null) {
          found.push({ written, node, options: [], optionNamespace: null });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const item of found) {
      const { namespace, key } = splitKey(item.written);
      uses.push({
        file: file.path,
        line: source.getLineAndCharacterOfPosition(item.node.getStart(source)).line + 1,
        namespace: namespace ?? item.optionNamespace ?? fileNamespace,
        key,
        options: item.options,
      });
    }
  }
  return uses;
}

function hasKey(catalog: Map<string, string> | undefined, key: string): boolean {
  return (
    catalog !== undefined &&
    (catalog.has(key) || catalog.has(`${key}_one`) || catalog.has(`${key}_other`))
  );
}

/** The values a key resolves to: the key itself, or its plural forms. */
function valuesOf(catalog: Map<string, string> | undefined, key: string): string[] {
  if (catalog === undefined) {
    return [];
  }
  return [key, `${key}_one`, `${key}_other`]
    .map((candidate) => catalog.get(candidate))
    .filter((value) => value !== undefined);
}

function interpolates(value: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\{\\{\\s*${escaped}\\s*(?:,[^}]*)?\\}\\}`).test(value);
}

function shapeIsValid(key: string): boolean {
  const segments = key.split('.');
  if (segments.length > MAX_SEGMENTS) {
    return false;
  }
  return segments.every((segment, index) =>
    index === segments.length - 1 ? LAST_SEGMENT.test(segment) : SEGMENT.test(segment),
  );
}

/** The checks of the catalog rules, over loaded catalogs and the keys code reads. Pure. */
export function checkCatalogs(
  catalogs: Catalogs,
  uses: readonly Use[],
  registryCodes: readonly string[],
  brand: readonly string[],
  context: { features: readonly string[]; dynamicKeys: readonly string[] },
): Problem[] {
  const problems: Problem[] = [];
  const codes = new Set(registryCodes);
  const dynamic = new Set(context.dynamicKeys);
  const features = new Set(context.features);
  const used = new Set<string>();

  for (const use of uses) {
    const namespace = use.namespace ?? DEFAULT_NAMESPACE;
    const catalog = catalogs.get(namespace);
    used.add(`${namespace}:${use.key}`);
    if (!hasKey(catalog, use.key)) {
      problems.push({
        kind: 'undefined-key',
        detail: `${use.file}:${String(use.line)} reads ${namespace}:${use.key}, which no catalog defines`,
      });
      continue;
    }
    const values = valuesOf(catalog, use.key);
    for (const name of use.options) {
      if (!NON_INTERPOLATED.has(name) && !values.every((value) => interpolates(value, name))) {
        problems.push({
          kind: 'interpolation',
          detail: `${use.file}:${String(use.line)} passes ${name} to ${namespace}:${use.key}, whose text has no {{${name}}}`,
        });
      }
    }
  }

  for (const [namespace, catalog] of catalogs) {
    if (!FIXED_NAMESPACES.has(namespace) && !features.has(namespace)) {
      problems.push({
        kind: 'namespace',
        detail: `catalog ${namespace} matches no feature folder and no fixed namespace`,
      });
    }
    for (const [key, value] of catalog) {
      const id = `${namespace}:${key}`;
      const isRegistryKey = namespace === 'errors' && codes.has(key);
      const base = key.replace(PLURAL, '');
      const isUsed = used.has(id) || used.has(`${namespace}:${base}`);
      if (!isUsed && namespace !== 'native' && !dynamic.has(id) && !isRegistryKey) {
        problems.push({ kind: 'unused-key', detail: `${id} is defined but never read` });
      }
      if (key.endsWith('_one') && !catalog.has(`${base}_other`)) {
        problems.push({ kind: 'plural-pair', detail: `${id} has no ${base}_other` });
      }
      if (key.endsWith('_other') && !catalog.has(`${base}_one`)) {
        problems.push({ kind: 'plural-pair', detail: `${id} has no ${base}_one` });
      }
      if (!isRegistryKey && !shapeIsValid(key)) {
        problems.push({
          kind: 'key-shape',
          detail: `${id} must be at most three camelCase segments, with an optional _about, _one or _other suffix`,
        });
      }
      const found = brandStringIn(value, brand);
      if (found !== null) {
        problems.push({ kind: 'brand', detail: `${id} writes "${found}"; use {{appName}}` });
      }
    }
  }

  const errors = catalogs.get('errors');
  for (const code of registryCodes) {
    if (errors?.has(code) !== true) {
      problems.push({
        kind: 'missing-error-key',
        detail: `errors:${code} is missing for an error code`,
      });
    }
  }
  problems.push(...advocacyProblems(catalogs), ...cautionProblems(catalogs));
  return problems;
}

/** Every catalog problem in the repository. */
export async function findProblems(root: string): Promise<Problem[]> {
  const catalogs = await loadCatalogs(root);
  const files = listSourceFiles(root).map((path) => ({
    path,
    text: readFileSync(join(root, path), 'utf8'),
  }));
  return checkCatalogs(catalogs, collectUses(files), Object.keys(ERROR_CODES), BRAND_FORBIDDEN, {
    features: folders(join(root, FEATURES_DIR)),
    dynamicKeys: await loadDynamicKeys(root),
  });
}

/** Prints each problem on one line; the exit code is 1 when there is any. */
export async function main(): Promise<number> {
  const problems = await findProblems(repoRoot());
  for (const problem of problems) {
    console.log(`${problem.kind}: ${problem.detail}`);
  }
  return problems.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
