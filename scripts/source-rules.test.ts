import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { issue, ISSUE_IDS } from '@citizenrun/shared';
import { repoRoot } from './lib/repo-root.ts';

const ROOT = repoRoot();
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '.expo', 'ios', 'android']);
const SKIPPED_PATHS = new Set(['packages/shared/src/api']);
const CARDS_SRC = 'packages/cards/src';
const PRIMITIVES = '@citizenrun/cards/primitives';

/** Every `.ts` and `.tsx` file under `apps/` and `packages/`, relative to the root. */
function sourceFiles(): string[] {
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
      const rel = relative(ROOT, path);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) && !SKIPPED_PATHS.has(rel)) {
          visit(path);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(rel);
      }
    }
  };
  visit(join(ROOT, 'apps'));
  visit(join(ROOT, 'packages'));
  return found.sort();
}

describe('source rules', () => {
  it('scans the source files of the packages', () => {
    expect(sourceFiles()).toContain('packages/shared/src/index.ts');
  });

  it('no compact notation through Intl', () => {
    const pattern = /notation\s*:\s*['"]compact['"]/;
    const offenders = sourceFiles().filter((file) =>
      pattern.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

/** The one file that divides a time difference by the length of a day. */
const DAY_COUNT_FILE = 'packages/shared/src/time/days-until.ts';
/** Generated files, which no rule here reads. */
const GENERATED_PATHS = ['packages/shared/src/brand.ts', 'packages/cards/src/generated/'];
/** A time difference divided by the length of a day. */
const DIVIDED_BY_A_DAY =
  /\/\s*\(?\s*(?:86_?400_?000|864e5|1000\s*\*\s*60\s*\*\s*60\s*\*\s*24|24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|86_?400\s*\*\s*1000|1000\s*\*\s*86_?400)\b/;
/** A day-count helper of a date library. */
const DAY_DIFFERENCE_HELPER = /\b(?:differenceInCalendarDays|differenceInDays)\b/;

/** The line numbers (from 1) of `source` that count days other than through daysUntil. */
function findDayCounts(source: string): number[] {
  return source
    .split('\n')
    .flatMap((line, index) =>
      DIVIDED_BY_A_DAY.test(line) || DAY_DIFFERENCE_HELPER.test(line) ? [index + 1] : [],
    );
}

describe('the only subtraction', () => {
  it('finds a difference divided by a day and leaves a later instant alone', () => {
    expect(findDayCounts('const d = (b - a) / 86_400_000;')).toEqual([1]);
    expect(findDayCounts('const later = now + 30 * 86_400_000;')).toEqual([]);
    expect(findDayCounts('const d = (b - a) / (24 * 60 * 60 * 1000);')).toEqual([1]);
    expect(findDayCounts('const x = 1;\nconst d = differenceInCalendarDays(b, a);')).toEqual([2]);
  });

  it('the only subtraction', () => {
    const files = sourceFiles().filter(
      (file) => file !== DAY_COUNT_FILE && !GENERATED_PATHS.some((path) => file.startsWith(path)),
    );
    expect(files).toContain('packages/shared/src/time/filing-window.ts');
    const offenders = files.flatMap((file) =>
      findDayCounts(readFileSync(join(ROOT, file), 'utf8')).map(
        (line) => `${file}:${String(line)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

/** Every `.ts` and `.tsx` file under `dir` (relative to the root), or none when the folder does not exist. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const visit = (path: string): void => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          visit(child);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(relative(ROOT, child));
      }
    }
  };
  visit(join(ROOT, dir));
  return found.sort();
}

/** The primitives no canvas uses: only the spike card draws the four spike elements, and nothing draws TSpan or Mask. */
const SPIKE_ONLY_PRIMITIVES: ReadonlySet<string> = new Set([
  'TSpan',
  'Defs',
  'LinearGradient',
  'Stop',
  'ClipPath',
  'Mask',
]);

/**
 * The spike-only names `source` imports from the primitives entry: named imports, with or without `type`,
 * across lines and after a default import. A namespace import reaches every primitive, so it is reported
 * as `* as <name>`.
 */
function forbiddenPrimitiveImports(source: string): string[] {
  const statement = /\bimport\s+(?:type\s+)?([^'";]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g;
  const names: string[] = [];
  for (const match of source.matchAll(statement)) {
    if (match[2] !== PRIMITIVES) {
      continue;
    }
    const clause = match[1] ?? '';
    const namespace = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (namespace?.[1] !== undefined) {
      names.push(`* as ${namespace[1]}`);
    }
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    for (const specifier of named.split(',')) {
      const imported = specifier
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (imported !== undefined && SPIKE_ONLY_PRIMITIVES.has(imported)) {
        names.push(imported);
      }
    }
  }
  return names;
}

/** The canvas files the plain-canvas rule covers. The spike card and its own test are the one exception (D-100). */
function plainCanvasFiles(): string[] {
  const spikeCard = new Set([
    `${CARDS_SRC}/templates/hello-card.tsx`,
    `${CARDS_SRC}/templates/hello-card.test.tsx`,
  ]);
  return ['templates', 'regions', 'model', 'art', 'generated']
    .flatMap((folder) => filesUnder(`${CARDS_SRC}/${folder}`))
    .filter((file) => !spikeCard.has(file));
}

/** The line numbers (from 1) of `source` that turn font scaling off. */
function findDisabledFontScaling(source: string): number[] {
  const pattern = /allowFontScaling\s*(=\s*\{\s*false\s*\}|:\s*false)/;
  return source.split('\n').flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}

describe('plain canvas imports', () => {
  it('finds a spike-only primitive among named imports', () => {
    const source = `import { Rect, ClipPath } from '${PRIMITIVES}';`;
    expect(forbiddenPrimitiveImports(source)).toEqual(['ClipPath']);
  });

  it('finds spike-only primitives in a type import spread across lines', () => {
    const source = [
      'import type {',
      '  RectProps,',
      '  TSpan as Line,',
      '  Mask,',
      `} from "${PRIMITIVES}";`,
      `import { type Defs, G } from '${PRIMITIVES}';`,
    ].join('\n');
    expect(forbiddenPrimitiveImports(source)).toEqual(['TSpan', 'Mask', 'Defs']);
  });

  it('finds a spike-only primitive after a default import', () => {
    const source = `import Primitives, { Rect, type ClipPath } from '${PRIMITIVES}';`;
    expect(forbiddenPrimitiveImports(source)).toEqual(['ClipPath']);
  });

  it('refuses a namespace import, which reaches every primitive', () => {
    expect(forbiddenPrimitiveImports(`import * as P from '${PRIMITIVES}';`)).toEqual(['* as P']);
    expect(forbiddenPrimitiveImports(`import Primitives, * as Q from '${PRIMITIVES}';`)).toEqual([
      '* as Q',
    ]);
  });

  it('accepts the plain primitives', () => {
    expect(forbiddenPrimitiveImports(`import { Rect } from '${PRIMITIVES}';`)).toEqual([]);
  });

  it('ignores the same names imported from another module', () => {
    expect(forbiddenPrimitiveImports("import { ClipPath } from 'react-native-svg';")).toEqual([]);
  });

  it('scans the card folders that exist', () => {
    expect(plainCanvasFiles()).toContain(`${CARDS_SRC}/art/empty-chair.tsx`);
    expect(plainCanvasFiles()).not.toContain(`${CARDS_SRC}/templates/hello-card.tsx`);
  });

  it('no canvas file imports a spike-only primitive', () => {
    const offenders = plainCanvasFiles().flatMap((file) =>
      forbiddenPrimitiveImports(readFileSync(join(ROOT, file), 'utf8')).map(
        (name) => `${file} imports ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('no canvas file but the spike card passes the clipPath prop', () => {
    const prop = /\bclipPath\s*[=:]/;
    const offenders = plainCanvasFiles().filter((file) =>
      prop.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('no text turns font scaling off', () => {
  it('finds allowFontScaling={false} on a Text element', () => {
    const source = ['const a = 1;', '<Text allowFontScaling={false}>Wren County</Text>'].join('\n');
    expect(findDisabledFontScaling(source)).toEqual([2]);
  });

  it('finds allowFontScaling: false in an object', () => {
    expect(findDisabledFontScaling('const props = { allowFontScaling: false };')).toEqual([1]);
  });

  it('accepts allowFontScaling={true}', () => {
    expect(findDisabledFontScaling('<Text allowFontScaling={true}>Alder</Text>')).toEqual([]);
  });

  it('no file of the app source turns font scaling off', () => {
    const files = filesUnder('apps/mobile/src');
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      findDisabledFontScaling(readFileSync(join(ROOT, file), 'utf8')).map(
        (line) => `${file}:${String(line)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

/** One row of the issue data file, in the shape the pipeline loads. */
type IssueRow = {
  id: string;
  name: string;
  sort: number;
  icon: string;
  colorLight: string;
  colorDark: string;
};

const ISSUE_ROW =
  /^- \{ id: ([a-z0-9-]+),\s+name: (.+),\s+sort: (\d+),\s+icon: ([a-z0-9-]+),\s+color_light: "(#[0-9A-F]{6})",\s+color_dark: "(#[0-9A-F]{6})" \}$/;

/**
 * Reads the issue data file line by line. A line that is not blank, not a comment and not a row in the
 * expected shape throws with its line number, so a change of format fails loudly.
 */
function readIssueRows(text: string): IssueRow[] {
  const rows: IssueRow[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '' || line.startsWith('#')) return;
    const match = ISSUE_ROW.exec(line);
    if (match === null) {
      throw new Error(`data/issues.yaml line ${String(index + 1)} is not an issue row: ${line}`);
    }
    const [, id = '', name = '', sort = '', icon = '', colorLight = '', colorDark = ''] = match;
    rows.push({ id, name, sort: Number(sort), icon, colorLight, colorDark });
  });
  return rows;
}

describe('issue art and data', () => {
  const rows = (): IssueRow[] =>
    readIssueRows(readFileSync(join(ROOT, 'data', 'issues.yaml'), 'utf8'));
  const sorted = (ids: readonly string[]): string[] => [...ids].sort();

  it('reads a row and refuses a line in another shape', () => {
    const row =
      '- { id: fixture-issue, name: "Fixture, issue", sort: 1,  icon: fixture-issue, color_light: "#0A0B0C", color_dark: "#1A1B1C" }';
    expect(readIssueRows(`# comment\n\n${row}\n`)).toEqual([
      {
        id: 'fixture-issue',
        name: '"Fixture, issue"',
        sort: 1,
        icon: 'fixture-issue',
        colorLight: '#0A0B0C',
        colorDark: '#1A1B1C',
      },
    ]);
    expect(() => readIssueRows(`${row}\n- id: fixture-issue\n`)).toThrow('line 2');
    expect(() => readIssueRows(row.replace('#0A0B0C', '#0a0b0c'))).toThrow('line 1');
  });

  it('issue icon files are the issue ids', () => {
    const files = readdirSync(join(ROOT, 'packages', 'cards', 'art', 'issues'))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.slice(0, -'.svg'.length));
    const data = rows();
    expect(data).toHaveLength(19);
    expect(sorted(files)).toEqual(sorted(data.map((row) => row.id)));
    expect(sorted(files)).toEqual(sorted(ISSUE_IDS));
    for (const row of data) {
      expect(row.icon, row.id).toBe(row.id);
    }
  });

  it('issue ids match the data file', () => {
    const data = [...rows()].sort((a, b) => a.sort - b.sort);
    expect(data.map((row) => row.id)).toEqual([...ISSUE_IDS]);
    for (const row of data) {
      const tokens: Readonly<Partial<Record<string, { light: string; dark: string }>>> = issue;
      expect(row.colorLight, `${row.id} light`).toBe(tokens[row.id]?.light);
      expect(row.colorDark, `${row.id} dark`).toBe(tokens[row.id]?.dark);
    }
  });
});
