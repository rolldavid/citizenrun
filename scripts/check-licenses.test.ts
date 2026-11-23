import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED,
  NO_DEPENDENCY_MESSAGE,
  UnreadableLicensesListError,
  findFailures,
  firstPath,
  invalidExceptions,
  isExcepted,
  main,
  parseLicensesList,
  satisfies,
} from './check-licenses.ts';
import type { LicenseEntry, LicenseException, PnpmRunner } from './check-licenses.ts';
import type { RunResult } from './lib/exec.ts';

const MIT_LIST = JSON.stringify({
  MIT: [{ name: 'fixture-package', versions: ['1.0.0'], license: 'MIT' }],
});

// Outputs that are not a licence list: each must fail the check for its workspace.
const UNREADABLE_OUTPUTS: readonly string[] = [
  `Agent skills awaiting approval: fixture-package.\n${MIT_LIST}`,
  [
    '   ╭──────────────────────────────────────────╮',
    '   │   Update available! 12.21.0 → 12.22.0.   │',
    '   ╰──────────────────────────────────────────╯',
    MIT_LIST,
  ].join('\n'),
  '',
  '   \n',
  'No licenses found',
  '[]',
  '{"MIT": "not a list"}',
];

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

  it('reads no rows only for the no-dependency message', () => {
    expect(NO_DEPENDENCY_MESSAGE).toBe('No licenses in packages found');
    expect(parseLicensesList('citizenrun', 'No licenses in packages found\n')).toEqual([]);
    expect(parseLicensesList('citizenrun', '{}\n')).toEqual([]);
    for (const stdout of UNREADABLE_OUTPUTS) {
      expect(() => parseLicensesList('citizenrun', stdout)).toThrow(UnreadableLicensesListError);
    }
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A runner standing in for pnpm: one workspace, whose licence list is `licenses`.
  function fakePnpm(licenses: string): PnpmRunner {
    return (args) => {
      const ok = (stdout: string): Promise<RunResult> =>
        Promise.resolve({ code: 0, stdout, stderr: '' });
      if (args[0] === 'ls') {
        return ok(JSON.stringify([{ name: '@citizenrun/fixture' }]));
      }
      if (args[0] === 'licenses') {
        return ok(licenses);
      }
      return ok('');
    };
  }

  async function runMain(licenses: string): Promise<{ code: number; printed: string[] }> {
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      printed.push(parts.map(String).join(' '));
    });
    const code = await main(fakePnpm(licenses));
    return { code, printed };
  }

  it('passes the no-dependency message and an allowed list', async () => {
    expect(await runMain('No licenses in packages found\n')).toEqual({ code: 0, printed: [] });
    expect(await runMain('{}\n')).toEqual({ code: 0, printed: [] });
    expect(await runMain(MIT_LIST)).toEqual({ code: 0, printed: [] });
  });

  it('fails a workspace whose list it cannot read', async () => {
    for (const stdout of UNREADABLE_OUTPUTS) {
      const { code, printed } = await runMain(stdout);
      expect(code).toBe(1);
      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain('@citizenrun/fixture');
      vi.restoreAllMocks();
    }
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
