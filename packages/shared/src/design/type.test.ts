import { describe, expect, it } from 'vitest';

import { RESOURCES, createI18n } from '../i18n/index.ts';
import { fontCovers } from './type.ts';
import type { FontFace } from './type.ts';

const FACES: readonly FontFace[] = ['regular', 'medium', 'bold', 'mono'];

/** Every string at any depth of a catalog, with its dotted key. */
function strings(value: unknown, path: string): [string, string][] {
  if (typeof value === 'string') {
    return [[path, value]];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) =>
      strings(inner, path === '' ? key : `${path}.${key}`),
    );
  }
  return [];
}

/** The text a face draws: the value without its {{...}} placeholders. */
function drawn(value: string): string {
  return value.replace(/\{\{[^}]*\}\}/g, '');
}

describe('font coverage', () => {
  it('fontCovers knows Vietnamese is missing', () => {
    expect(fontCovers('medium', 'Nguyễn')).toBe(false);
    expect(fontCovers('medium', 'Niño')).toBe(true);
  });

  it('the mono face draws Vietnamese', () => {
    expect(fontCovers('mono', 'Nguyễn')).toBe(true);
    expect(fontCovers('mono', 'Phạm Thị')).toBe(true);
    expect(fontCovers('mono', '≤ 3 ‰')).toBe(true);
    expect(fontCovers('mono', '→')).toBe(false);
    expect(fontCovers('regular', '≤ ←')).toBe(true);
  });

  it('fontCovers range edges', () => {
    expect(fontCovers('medium', ' ')).toBe(true);
    expect(fontCovers('medium', '~')).toBe(true);
    expect(fontCovers('medium', '­')).toBe(false);
    expect(fontCovers('medium', '¬')).toBe(true);
    expect(fontCovers('medium', '®')).toBe(true);
    expect(fontCovers('regular', '→')).toBe(true);
    expect(fontCovers('mono', '→')).toBe(false);
    for (const face of FACES) {
      expect(fontCovers(face, '\u{1F600}'), face).toBe(false);
      expect(fontCovers(face, ''), face).toBe(true);
    }
    expect(() => fontCovers('medium', '\u{1F600}a')).not.toThrow();
    expect(fontCovers('medium', '\u{1F600}a')).toBe(false);
  });

  it('every English catalog value is drawable in the sans face', () => {
    const values = Object.entries(RESOURCES.en).flatMap(([namespace, catalog]) =>
      strings(catalog, namespace),
    );
    expect(values.length).toBeGreaterThan(0);
    const undrawable = values
      .filter(([, value]) => !fontCovers('regular', drawn(value)))
      .map(([key]) => key);
    expect(undrawable).toEqual([]);
  });

  it('every common ui string is drawable in the mono face', () => {
    // Every value under common.ui, which holds the strings the design system owns.
    const catalog: Readonly<Record<string, unknown>> = RESOURCES.en.common;
    const values = strings(catalog.ui, 'common.ui');
    const undrawable = values
      .filter(([, value]) => !fontCovers('mono', drawn(value)))
      .map(([key]) => key);
    expect(undrawable).toEqual([]);
  });
});

/**
 * Every value that writes the product's name in any form, the right one included, once the
 * identifier forms are left out: a catalog names the product only as {{appName}} (D-016).
 */
function findNameMisspellings(values: readonly string[]): string[] {
  const identifiers = ['@citizenrun/', '.citizenrun', 'citizenrun.', 'citizenrun/'];
  return values.filter((value) => {
    let checked = value;
    for (const identifier of identifiers) {
      checked = checked.split(identifier).join(' ');
    }
    return /citizen\s*run|open\s*seats/iu.test(checked);
  });
}

describe('the product name in the catalogs', () => {
  it('no catalog value spells the name', () => {
    const instance = createI18n();
    const { ns } = instance.options;
    const namespaces = ns === undefined ? [] : typeof ns === 'string' ? [ns] : ns;
    expect(namespaces.length).toBeGreaterThan(0);
    const values = namespaces.flatMap((namespace) =>
      strings(instance.getResourceBundle('en', namespace), namespace).map(([, value]) => value),
    );
    expect(values.length).toBeGreaterThan(0);
    expect(findNameMisspellings(values)).toEqual([]);
  });

  it('the checker finds every misspelling', () => {
    // Each form is built from two parts, so this file spells none of them.
    const named = [
      `Welcome to ${'Open' + 'Seats'} today.`,
      `Welcome to ${'Open' + ' Seats'} today.`,
      `Welcome to ${'Citizen' + ' Run'} today.`,
      `Welcome to ${'CITIZEN' + 'RUN'} today.`,
      `Welcome to ${'Citizen' + 'run'} today.`,
      `Welcome to ${'citizen' + 'run'} today.`,
      `Welcome to ${'Citizen' + 'Run'} today.`,
    ];
    const clean = [
      '{{appName}} is running.',
      '@citizenrun/shared',
      'https://example.test/citizenrun/x',
    ];
    expect(findNameMisspellings([...named, ...clean])).toEqual(named);
  });
});
