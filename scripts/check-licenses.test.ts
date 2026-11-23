import { describe, expect, it } from 'vitest';
import {
  ALLOWED,
  findFailures,
  firstPath,
  invalidExceptions,
  isExcepted,
  parseLicensesList,
  satisfies,
} from './check-licenses.ts';
import type { LicenseEntry, LicenseException } from './check-licenses.ts';

const LGPL_ENTRY: LicenseEntry = {
  workspace: '@citizenrun/cards',
  name: '@img/sharp-libvips-darwin-arm64',
  version: '1.3.0',
  license: 'LGPL-3.0-or-later',
};

const EXCEPTION: LicenseException = {
  package: '@img/sharp-libvips-*',
  versions: ['1.3.0'],
  workspaces: ['@citizenrun/cards'],
  decision: 'D-600',
  reason: 'fixture',
};

describe('satisfies', () => {
  it.each(['MIT', 'MIT-0', '(MIT OR GPL-3.0-only)', 'Apache-2.0 AND MIT', 'BlueOak-1.0.0'])(
    'passes %s',
    (expression) => {
      expect(satisfies(expression, ALLOWED)).toBe(true);
    },
  );

  it.each([
    '(MIT AND Zlib)',
    'GPL-3.0-or-later',
    'LGPL-3.0-or-later',
    'Apache-2.0 WITH LLVM-exception',
    '',
    'UNKNOWN',
    'MIT OR',
    '(MIT',
    'SEE LICENSE IN LICENSE.md',
  ])('fails %s', (expression) => {
    expect(satisfies(expression, ALLOWED)).toBe(false);
  });

  it('allows a WITH term only when the whole term is on the list', () => {
    const allowed = new Set(['GPL-2.0-only WITH Classpath-exception-2.0']);
    expect(satisfies('GPL-2.0-only WITH Classpath-exception-2.0', allowed)).toBe(true);
    expect(satisfies('GPL-2.0-only', allowed)).toBe(false);
  });
});

describe('exceptions', () => {
  it('reports an exception that cites no decision and does not apply it', () => {
    const bad = { ...EXCEPTION, decision: 'because' };
    expect(invalidExceptions([bad])).toHaveLength(1);
    expect(invalidExceptions([EXCEPTION])).toEqual([]);
    expect(isExcepted(LGPL_ENTRY, [bad])).toBe(false);
    expect(findFailures([LGPL_ENTRY], [bad])).toEqual([LGPL_ENTRY]);
  });

  it('applies only to its listed workspaces and versions', () => {
    expect(isExcepted(LGPL_ENTRY, [EXCEPTION])).toBe(true);
    expect(findFailures([LGPL_ENTRY], [EXCEPTION])).toEqual([]);
    expect(isExcepted({ ...LGPL_ENTRY, workspace: '@citizenrun/mobile' }, [EXCEPTION])).toBe(false);
    expect(isExcepted({ ...LGPL_ENTRY, version: '1.4.0' }, [EXCEPTION])).toBe(false);
    expect(isExcepted({ ...LGPL_ENTRY, name: '@img/other' }, [EXCEPTION])).toBe(false);
  });

  it('never lets an allowed licence fail', () => {
    expect(findFailures([{ ...LGPL_ENTRY, license: 'MIT' }], [])).toEqual([]);
  });
});

describe('parseLicensesList', () => {
  it('reads one row per package version and uses the group when a package has no licence field', () => {
    const stdout = JSON.stringify({
      MIT: [{ name: 'a', versions: ['1.0.0', '2.0.0'], license: 'MIT' }],
      Unknown: [{ name: 'b', versions: ['0.1.0'] }],
    });
    expect(parseLicensesList('citizenrun', stdout)).toEqual([
      { workspace: 'citizenrun', name: 'a', version: '1.0.0', license: 'MIT' },
      { workspace: 'citizenrun', name: 'a', version: '2.0.0', license: 'MIT' },
      { workspace: 'citizenrun', name: 'b', version: '0.1.0', license: 'Unknown' },
    ]);
    expect(satisfies('Unknown', ALLOWED)).toBe(false);
  });

  it('reads no rows from output that is not JSON', () => {
    expect(parseLicensesList('citizenrun', 'No licenses in packages found')).toEqual([]);
  });
});

describe('firstPath', () => {
  it('follows the first branch of the tree to the workspace that needs the package', () => {
    const output = [
      'b@1.0.0',
      '└─┬ a@2.0.0',
      '  ├─┬ tool@3.0.0',
      '  │ └── citizenrun (devDependencies)',
      '  └── @citizenrun/db (dependencies)',
    ].join('\n');
    expect(firstPath(output)).toBe('b@1.0.0 < a@2.0.0 < tool@3.0.0 < citizenrun');
  });
});
