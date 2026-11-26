import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogsFrom, checkCatalogs, collectUses, listSourceFiles, main } from './check-i18n.ts';
import type { Problem, ProblemKind, Use } from './check-i18n.ts';
import { BrandSchema } from './gen-brand.ts';
import { repoRoot } from './lib/repo-root.ts';

const DISPLAY_NAME = BrandSchema.parse(
  JSON.parse(readFileSync(join(repoRoot(), 'brand.json'), 'utf8')),
).displayName;
const CODES = ['invalid_request', 'rate_limited'];
const ERRORS = { invalid_request: 'Check it.', rate_limited: 'Wait.' };
const CONTEXT = { features: ['office'], dynamicKeys: [] };

function use(key: string, options: readonly string[] = [], namespace: string | null = null): Use {
  return { file: 'apps/mobile/src/features/office/a.tsx', line: 1, namespace, key, options };
}

function kinds(problems: readonly Problem[]): ProblemKind[] {
  return problems.map((problem) => problem.kind);
}

function check(
  catalogs: Record<string, object>,
  uses: readonly Use[],
  context: { features: readonly string[]; dynamicKeys: readonly string[] } = CONTEXT,
): Problem[] {
  return checkCatalogs(
    catalogsFrom({ errors: ERRORS, ...catalogs }),
    uses,
    CODES,
    [DISPLAY_NAME],
    context,
  );
}

describe('checkCatalogs', () => {
  it('reports a key read in code that no catalog defines', () => {
    const problems = check({ common: { about: 'about' } }, [
      use('about'),
      use('missing', [], 'common'),
    ]);
    expect(kinds(problems)).toEqual(['undefined-key']);
    expect(problems[0]?.detail).toContain('common:missing');
  });

  it('reports an unread common key, but not an unread native key, error code or dynamic key', () => {
    const problems = check(
      {
        common: { about: 'about', spare: 'spare', listed: 'listed' },
        native: { permissions: { camera: 'x' } },
      },
      [use('about')],
      { features: [], dynamicKeys: ['common:listed'] },
    );
    expect(problems).toEqual([
      { kind: 'unused-key', detail: 'common:spare is defined but never read' },
    ]);
  });

  it('reports a plural key without its pair', () => {
    const problems = check({ common: { item_one: '{{count}} item' } }, [use('item', ['count'])]);
    expect(kinds(problems)).toEqual(['plural-pair']);
  });

  it('accepts a plural pair read by its base key', () => {
    const problems = check(
      { common: { item_one: '{{count}} item', item_other: '{{count}} items' } },
      [use('item', ['count'])],
    );
    expect(problems).toEqual([]);
  });

  it('reports a key deeper than three segments and a segment that is not camelCase', () => {
    const problems = check({ common: { a: { b: { c: { d: 'deep' } } }, Bad_Key: 'bad' } }, [
      use('a.b.c.d'),
      use('Bad_Key'),
    ]);
    expect(kinds(problems)).toEqual(['key-shape', 'key-shape']);
  });

  it('keeps the snake_case spelling of a registry code in the errors catalog', () => {
    const problems = check({}, [use('invalid_request', [], 'errors')]);
    expect(problems).toEqual([]);
  });

  it('reports a catalog that matches no feature folder', () => {
    const problems = check({ foo: { title: 'Foo' } }, [use('title', [], 'foo')]);
    expect(kinds(problems)).toEqual(['namespace']);
    expect(check({ office: { title: 'Office' } }, [use('title', [], 'office')])).toEqual([]);
  });

  it('reports an error code with no errors key', () => {
    const problems = checkCatalogs(
      catalogsFrom({ errors: { invalid_request: 'Check it.' } }),
      [],
      CODES,
      [DISPLAY_NAME],
      CONTEXT,
    );
    expect(problems).toEqual([
      { kind: 'missing-error-key', detail: 'errors:rate_limited is missing for an error code' },
    ]);
  });

  it('reports an option the text does not interpolate', () => {
    const problems = check({ common: { aboutValue: 'about {{value}}' } }, [
      use('aboutValue', ['amount'], 'common'),
    ]);
    expect(kinds(problems)).toEqual(['interpolation']);
    expect(
      check({ common: { aboutValue: 'about {{value, number}}' } }, [
        use('aboutValue', ['value', 'count']),
      ]),
    ).toEqual([]);
  });

  it('reports a catalog value that writes the display name', () => {
    const problems = check({ common: { welcome: `Welcome to ${DISPLAY_NAME}` } }, [use('welcome')]);
    expect(kinds(problems)).toEqual(['brand']);
    expect(
      check({ common: { welcome: 'Welcome to {{appName}}' } }, [use('welcome', ['appName'])]),
    ).toEqual([]);
  });
});

describe('collectUses', () => {
  it('reads literal keys from t calls, member t calls and i18nKey attributes', () => {
    const uses = collectUses([
      {
        path: 'apps/mobile/src/features/office/a.tsx',
        text: [
          "const { t } = useTranslation('office');",
          "t('title');",
          "i18n.t('common:about', { value: 1 });",
          't(`errors:not_found`);',
          't(dynamicKey);',
          'const a = <Trans i18nKey="summary" />;',
          "const b = <Trans i18nKey={'cards:alt.pay'} />;",
          "t('heading', 'fallback', { ns: 'cards', count: 2 });",
        ].join('\n'),
      },
    ]);
    expect(uses.map((item) => [item.namespace, item.key, item.options])).toEqual([
      ['office', 'title', []],
      ['common', 'about', ['value']],
      ['errors', 'not_found', []],
      ['office', 'summary', []],
      ['cards', 'alt.pay', []],
      ['cards', 'heading', ['ns', 'count']],
    ]);
    expect(uses[1]?.line).toBe(3);
  });

  it('leaves the namespace unset when the file names none', () => {
    const uses = collectUses([{ path: 'packages/shared/src/x.ts', text: "t('notKnownYet');" }]);
    expect(uses.map((item) => item.namespace)).toEqual([null]);
  });
});

describe('listSourceFiles', () => {
  it('leaves out every generated folder and the catalogs', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-i18n-'));
    try {
      for (const path of [
        'packages/shared/src/api/client.ts',
        'packages/shared/src/i18n/en/common.ts',
        'packages/cards/src/generated/index.ts',
        'packages/cards/src/card.tsx',
        'apps/mobile/src/screen.tsx',
      ]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), 'export {};\n');
      }
      expect(listSourceFiles(root)).toEqual([
        'apps/mobile/src/screen.tsx',
        'packages/cards/src/card.tsx',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('check:i18n over the repository', () => {
  it('finds no problem', async () => {
    expect(await main()).toBe(0);
  });
});
