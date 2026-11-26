import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { SELECTORS } from '../apps/mobile/e2e/selectors.ts';
import { repoRoot } from './lib/repo-root.ts';

// TEST-e2e-selectors: the journeys and the phone flows find elements only by testID, from one
// registry. Every id in it, and every `id:` of a flow, must be a string the app's source holds, so a
// renamed testID breaks this test rather than a journey; every id has the `<feature>.<element>` form.

const ROOT = repoRoot();
/** The folders whose source carries the app's testIDs. */
const SOURCE_DIRS = ['apps/mobile/src', 'apps/mobile/app'];
const FLOWS_DIR = 'apps/mobile/.maestro';
const SOURCE_FILE = /\.tsx?$/;
/** A test names ids it expects; only the code that renders them counts. */
const TEST_FILE = /\.test\.tsx?$/;
const FLOW_FILE = /\.ya?ml$/;
const ID_FORM = /^[a-z][a-z0-9]*\.[a-z0-9]+(-[a-z0-9]+)*$/;
/** A whole single- or double-quoted string literal on one line. */
const QUOTED = /'([^'\\\n]*)'|"([^"\\\n]*)"/g;
/** An `id:` of a flow, quoted or not. */
const FLOW_ID = /\bid:\s*(?:'([^']*)'|"([^"]*)"|([^\s#'"]+))/g;

/** A registry entry for an id a component derives from the `testID` it is given. */
type DerivedEntry = { readonly base: string; id(arg: string): string };
/** The registry's shape: features, each mapping names to an id or a derived entry. */
type Registry = Readonly<Record<string, Readonly<Record<string, string | DerivedEntry>>>>;
/** The registry read flat: its plain ids and its derived entries, each with its dotted name. */
type FlatRegistry = {
  ids: { name: string; id: string }[];
  derived: { name: string; entry: DerivedEntry }[];
};

/** Splits the registry into its plain ids and its derived entries. */
export function flattenRegistry(registry: Registry): FlatRegistry {
  const flat: FlatRegistry = { ids: [], derived: [] };
  for (const [feature, entries] of Object.entries(registry)) {
    for (const [key, value] of Object.entries(entries)) {
      const name = `${feature}.${key}`;
      if (typeof value === 'string') {
        flat.ids.push({ name, id: value });
      } else {
        flat.derived.push({ name, entry: value });
      }
    }
  }
  return flat;
}

/** Every whole quoted string literal in a source text. */
export function quotedLiterals(source: string): string[] {
  return [...source.matchAll(QUOTED)].map((match) => match[1] ?? match[2] ?? '');
}

/**
 * The ids of a registry that no source literal holds: each plain id, and each derived entry's
 * base. Empty when every one is in the app.
 */
export function missingSelectors(registry: Registry, literals: ReadonlySet<string>): string[] {
  const flat = flattenRegistry(registry);
  return [...flat.ids.map(({ id }) => id), ...flat.derived.map(({ entry }) => entry.base)].filter(
    (id) => !literals.has(id),
  );
}

/** The flow ids that are neither a plain id of the registry nor an id derived from one of its bases. */
export function unknownFlowIds(registry: Registry, flowIds: readonly string[]): string[] {
  const flat = flattenRegistry(registry);
  const plain = new Set(flat.ids.map(({ id }) => id));
  const bases = flat.derived.map(({ entry }) => entry.base);
  return flowIds.filter((id) => !plain.has(id) && !bases.some((base) => id.startsWith(`${base}-`)));
}

/** Every `id:` value of a flow text. */
export function flowIds(source: string): string[] {
  return [...source.matchAll(FLOW_ID)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
}

/** The flow commands whose argument is the element they act on. */
const TARGET_COMMANDS: ReadonlySet<string> = new Set(['tapOn', 'doubleTapOn', 'longPressOn']);
/**
 * The labels of the system's own prompts, which carry no testID and are found by their text: the
 * iOS simulator asks with "Open" before it opens a link in the app.
 */
const SYSTEM_PROMPT_LABELS: ReadonlySet<string> = new Set(['Open']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The texts a flow finds a target by: a tap's text, or the element a scroll looks for by text. */
export function textTargets(source: string): string[] {
  const found: string[] = [];
  for (const document of parseAllDocuments(source)) {
    const steps: unknown = document.toJS();
    if (!Array.isArray(steps)) {
      continue;
    }
    for (const step of steps as unknown[]) {
      if (!isRecord(step)) {
        continue;
      }
      for (const [command, argument] of Object.entries(step)) {
        const target = TARGET_COMMANDS.has(command)
          ? argument
          : command === 'scrollUntilVisible' && isRecord(argument)
            ? argument.element
            : undefined;
        if (typeof target === 'string') {
          found.push(target);
        } else if (isRecord(target) && typeof target.text === 'string') {
          found.push(target.text);
        }
      }
    }
  }
  return found;
}

/** The files under a folder, at any depth, whose names match. */
function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => pattern.test(path))
    .map((path) => join(ROOT, dir, path));
}

function sourceLiterals(): Set<string> {
  const literals = new Set<string>();
  for (const dir of SOURCE_DIRS) {
    for (const file of filesUnder(dir, SOURCE_FILE)) {
      if (TEST_FILE.test(file)) {
        continue;
      }
      for (const literal of quotedLiterals(readFileSync(file, 'utf8'))) {
        literals.add(literal);
      }
    }
  }
  return literals;
}

/** The flows of the folder; the scripts folder holds none. */
function flowFiles(): string[] {
  return readdirSync(join(ROOT, FLOWS_DIR), { encoding: 'utf8' })
    .filter((name) => FLOW_FILE.test(name) && name !== 'config.yaml')
    .map((name) => join(ROOT, FLOWS_DIR, name));
}

const flat = flattenRegistry(SELECTORS);

describe('the selector registry', () => {
  it('every selector is in the app', () => {
    expect(flat.ids.length).toBeGreaterThan(0);
    expect(missingSelectors(SELECTORS, sourceLiterals())).toEqual([]);
  });

  it('ids have the feature.element form', () => {
    const ids = [
      ...flat.ids.map(({ name, id }) => ({ name, id })),
      ...flat.derived.map(({ name, entry }) => ({ name, id: entry.base })),
    ];
    expect(ids.filter(({ id }) => !ID_FORM.test(id))).toEqual([]);
  });

  it('derived ids extend their base', () => {
    expect(flat.derived.length).toBeGreaterThan(0);
    for (const { name, entry } of flat.derived) {
      expect(entry.id('x').startsWith(`${entry.base}-`), name).toBe(true);
    }
  });

  it('every flow id is a selector', () => {
    const files = flowFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const ids = flowIds(readFileSync(file, 'utf8'));
      expect(ids.length, file).toBeGreaterThan(0);
      expect(unknownFlowIds(SELECTORS, ids), file).toEqual([]);
    }
  });

  it('a flow finds its targets by id, and by text only on a system prompt', () => {
    for (const file of flowFiles()) {
      const texts = textTargets(readFileSync(file, 'utf8'));
      expect(
        texts.filter((text) => !SYSTEM_PROMPT_LABELS.has(text)),
        file,
      ).toEqual([]);
    }
  });

  it('reads a target found by text in each form', () => {
    const flow = [
      'appId: x',
      '---',
      "- tapOn: 'Save'",
      '- tapOn:',
      "    text: 'Open'",
      '    optional: true',
      '- tapOn:',
      "    id: 'auth.here'",
      '- scrollUntilVisible:',
      '    element:',
      "      text: 'Far down'",
      '- scrollUntilVisible:',
      '    element:',
      "      id: 'auth.far'",
      "- assertVisible: 'Shown'",
    ].join('\n');
    expect(textTargets(flow)).toEqual(['Save', 'Open', 'Far down']);
  });

  it('fails on an unknown id', () => {
    const registry: Registry = {
      auth: {
        here: 'auth.here',
        notThere: 'auth.not-there',
        option: { base: 'auth.option', id: (value) => `auth.option-${value}` },
      },
    };
    const source = `<Field testID="auth.here" />\nconst rows = { testID: 'auth.option' };`;
    expect(missingSelectors(registry, new Set(quotedLiterals(source)))).toEqual(['auth.not-there']);
    expect(missingSelectors(registry, new Set(quotedLiterals('')))).toEqual([
      'auth.here',
      'auth.not-there',
      'auth.option',
    ]);
    expect(
      unknownFlowIds(
        registry,
        flowIds("- tapOn:\n    id: 'auth.option-1'\n- tapOn:\n    id: auth.gone"),
      ),
    ).toEqual(['auth.gone']);
  });
});
