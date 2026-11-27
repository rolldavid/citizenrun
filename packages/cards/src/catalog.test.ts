import { createI18n } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import type { FontFace } from './primitives/types.ts';
import { canDraw } from './text/fold.ts';

// CARD-tests: the catalog strings a canvas draws keep to their budgets and can be drawn in their
// faces, and none drawn as a mono label carries the product's name.

type Namespace = 'common' | 'cards';
/** Every value of the two catalogs a canvas reads, by `<namespace>:<dotted key>`. */
type Catalog = ReadonlyMap<string, string>;

/** The catalog values of `bundles`, walked to dotted keys. */
function walk(bundles: Readonly<Record<Namespace, unknown>>): Catalog {
  const values = new Map<string, string>();
  const visit = (prefix: string, node: unknown): void => {
    if (typeof node === 'string') {
      values.set(prefix, node);
      return;
    }
    if (typeof node !== 'object' || node === null) {
      throw new Error(`${prefix} is neither a string nor a group`);
    }
    for (const [key, child] of Object.entries(node)) {
      visit(prefix.endsWith(':') ? `${prefix}${key}` : `${prefix}.${key}`, child);
    }
  };
  for (const [namespace, bundle] of Object.entries(bundles)) {
    visit(`${namespace}:`, bundle);
  }
  return values;
}

function catalogBundles(): Record<Namespace, unknown> {
  const i18n = createI18n();
  return {
    common: i18n.getResourceBundle('en', 'common'),
    cards: i18n.getResourceBundle('en', 'cards'),
  };
}

/** A row of a table: keys named exactly, or every key under a prefix ending in `.` or a partial key ending in `*`. */
type KeySet = readonly string[];

function matches(key: string, pattern: string): boolean {
  return pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern;
}

/** The keys of the catalog a row names; a row that names a key or a prefix the catalog lacks is a problem. */
function keysOf(catalog: Catalog, keys: KeySet, problems: string[]): string[] {
  const found: string[] = [];
  for (const pattern of keys) {
    const hits = [...catalog.keys()].filter((key) => matches(key, pattern));
    if (hits.length === 0) {
      problems.push(`${pattern} names no key of the catalog`);
    }
    found.push(...hits);
  }
  return found;
}

/** The length of a string in code points. */
function lengthOf(text: string): number {
  return Array.from(text).length;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*(?:,[^}]*)?\}\}/g;

/** The value with each placeholder replaced by the longest value a canvas gives it. */
function interpolate(
  key: string,
  value: string,
  values: Readonly<Record<string, string>>,
  problems: string[],
): string {
  return value.replace(PLACEHOLDER, (_whole, name: string) => {
    const given = values[name];
    if (given === undefined) {
      problems.push(`${key} has a placeholder {{${name}}} with no longest value`);
      return '';
    }
    return given;
  });
}

/** The longest values a canvas interpolates into a budgeted string. */
const SOURCE_DATE = 'Sep 30, 2026';
const SHORT_DATE = 'Wed, Sep 30';
const LONGEST = { hours: '37.5', count: '30' } as const;

type BudgetRow = {
  keys: KeySet;
  budget: number;
  values: Readonly<Record<string, string>>;
};

const BUDGETS: readonly BudgetRow[] = [
  {
    keys: [
      'common:issueShort.*',
      'cards:kicker.levelLocal',
      'cards:kicker.levelCounty',
      'cards:kicker.levelState',
      'cards:kicker.levelFederal',
      'cards:kicker.levelSpecial',
    ],
    budget: 30,
    values: {},
  },
  {
    keys: [
      'cards:fact.pay',
      'cards:fact.votesToWin',
      'cards:fact.filing',
      'cards:fact.nextElection',
    ],
    budget: 17,
    values: {},
  },
  { keys: ['cards:fact.daysToFile_one', 'cards:fact.daysToFile_other'], budget: 16, values: {} },
  {
    keys: ['common:notKnownYet', 'cards:fact.filingClosed', 'cards:fact.noneSet'],
    budget: 18,
    values: {},
  },
  // With the publisher empty, a publisher of at least two characters always fits.
  { keys: ['cards:source.*'], budget: 39, values: { publisher: '', date: SOURCE_DATE } },
  { keys: ['common:about'], budget: 6, values: {} },
  { keys: ['cards:run.caption*'], budget: 40, values: { ...LONGEST, date: SHORT_DATE } },
  { keys: ['cards:fact.closes'], budget: 20, values: { date: SHORT_DATE } },
  { keys: ['cards:fact.closesYear'], budget: 20, values: { date: 'Sep 30, 2027' } },
];

/** One sentence per catalog string over its budget after interpolation. */
function budgetProblems(catalog: Catalog): string[] {
  const problems: string[] = [];
  for (const row of BUDGETS) {
    for (const key of keysOf(catalog, row.keys, problems)) {
      const text = interpolate(key, catalog.get(key) ?? '', row.values, problems);
      const length = lengthOf(text);
      if (length > row.budget) {
        problems.push(
          `${key} "${text}" is ${String(length)} characters, over its budget of ${String(row.budget)}`,
        );
      }
    }
  }
  return problems;
}

type FaceRow = { keys: KeySet; faces: readonly FontFace[]; upper: boolean };

/** The first row: the strings drawn as mono labels, in capitals. */
const MONO_LABELS: FaceRow = {
  keys: [
    'common:issueShort.*',
    'cards:kicker.*',
    'cards:fact.pay',
    'cards:fact.votesToWin',
    'cards:fact.daysToFile_one',
    'cards:fact.daysToFile_other',
    'cards:fact.filing',
    'cards:fact.nextElection',
  ],
  faces: ['mono'],
  upper: true,
};

const FACES: readonly FaceRow[] = [
  MONO_LABELS,
  { keys: ['cards:source.*'], faces: ['mono'], upper: false },
  {
    keys: [
      'cards:run.*',
      'cards:place.*',
      'cards:officeType.*',
      'cards:fact.filingClosed',
      'cards:fact.noneSet',
      'common:about',
      'common:notKnownYet',
    ],
    faces: ['medium'],
    upper: false,
  },
  { keys: ['cards:holder.*'], faces: ['medium', 'regular'], upper: false },
  {
    keys: ['cards:election.*', 'cards:fact.closes', 'cards:fact.closesYear'],
    faces: ['regular'],
    upper: false,
  },
  { keys: ['cards:figure.moneyCompact'], faces: ['bold'], upper: false },
];

/** The `cards` keys no canvas draws: alt text, the card header, the deal line and the native deadline labels. */
const NOT_DRAWN: KeySet = [
  'cards:alt.*',
  'cards:header.*',
  'cards:deal.*',
  'cards:deadline.unknown',
  'cards:deadline.opensIn_one',
  'cards:deadline.opensIn_other',
  'cards:deadline.closesToday',
  'cards:deadline.closesTodayAt',
  'cards:deadline.closesIn_one',
  'cards:deadline.closesIn_other',
  'cards:deadline.closed',
];

/** One sentence per catalog string a canvas cannot draw in its face, and per `cards` key in no row. */
function drawableProblems(catalog: Catalog): string[] {
  const problems: string[] = [];
  const placed = new Set<string>(keysOf(catalog, NOT_DRAWN, problems));
  for (const row of FACES) {
    for (const key of keysOf(catalog, row.keys, problems)) {
      placed.add(key);
      const bare = (catalog.get(key) ?? '').replace(/\{\{[^}]*\}\}/g, '');
      const text = row.upper ? bare.toLocaleUpperCase('en-US') : bare;
      for (const face of row.faces) {
        if (!canDraw(text, face)) {
          problems.push(`${key} "${text}" cannot be drawn in the ${face} face`);
        }
      }
    }
  }
  for (const key of catalog.keys()) {
    if (key.startsWith('cards:') && !placed.has(key)) {
      problems.push(`${key} is in no row of the drawable table`);
    }
  }
  return problems;
}

/** One sentence per mono label that carries the product's name. */
function capitalNameProblems(catalog: Catalog): string[] {
  const problems: string[] = [];
  for (const key of keysOf(catalog, MONO_LABELS.keys, problems)) {
    if (/\{\{\s*appName\b/.test(catalog.get(key) ?? '')) {
      problems.push(`${key} is drawn in capitals and holds {{appName}}`);
    }
  }
  return problems;
}

describe('catalog', () => {
  const catalog = walk(catalogBundles());

  it('catalog strings fit', () => {
    expect(budgetProblems(catalog)).toEqual([]);
  });

  it('catalog strings are drawable', () => {
    expect(drawableProblems(catalog)).toEqual([]);
  });

  it('the name is never in capitals', () => {
    expect(capitalNameProblems(catalog)).toEqual([]);
  });
});
