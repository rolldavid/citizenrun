import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkActionText,
  checkWorkflowText,
  cronMinutes,
  workflowFiles,
} from './check-workflows.ts';
import type { Violation } from './check-workflows.ts';
import { repoRoot } from './lib/repo-root.ts';

// Made-up commit SHAs: the fixtures only need the shape of a pin.
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

const CHECKOUT = `      - uses: actions/checkout@${SHA_A} # v9.9.9`;

type Parts = {
  name?: string;
  on?: string;
  permissions?: string | null;
  extraTop?: string;
  job?: string;
};

/** A workflow that passes every rule unless a part replaces one of its sections. */
function workflow(parts: Parts = {}): string {
  const lines = [`name: ${parts.name ?? 'sample'}`, parts.on ?? 'on:\n  pull_request:'];
  if (parts.permissions !== null) {
    lines.push(parts.permissions ?? 'permissions:\n  contents: read');
  }
  if (parts.extraTop !== undefined) {
    lines.push(parts.extraTop);
  }
  lines.push(
    'jobs:',
    parts.job ??
      [
        '  build:',
        '    runs-on: ubuntu-24.04',
        '    timeout-minutes: 5',
        '    steps:',
        CHECKOUT,
      ].join('\n'),
  );
  return `${lines.join('\n')}\n`;
}

function job(settings: readonly string[], steps: readonly string[] = [CHECKOUT]): string {
  return ['  build:', ...settings.map((line) => `    ${line}`), '    steps:', ...steps].join('\n');
}

const BASE_JOB = ['runs-on: ubuntu-24.04', 'timeout-minutes: 5'];

function rules(violations: readonly Violation[]): string[] {
  return violations.map((violation) => violation.rule);
}

function scheduled(overrides: { on?: string; concurrency?: string | null } = {}): string {
  return workflow({
    name: 'nightly',
    on: overrides.on ?? "on:\n  schedule:\n    - cron: '17 7 * * *'\n  workflow_dispatch:",
    ...(overrides.concurrency === null
      ? {}
      : {
          extraTop:
            overrides.concurrency ?? 'concurrency:\n  group: nightly\n  cancel-in-progress: false',
        }),
  });
}

describe('checkWorkflowText', () => {
  it('passes the fixture workflow', () => {
    expect(checkWorkflowText('sample.yml', workflow())).toEqual([]);
  });

  it('a workflow without top-level read permissions fails', () => {
    for (const permissions of [null, 'permissions: write-all', 'permissions:\n  contents: write']) {
      const text = workflow({ permissions });
      expect(rules(checkWorkflowText('sample.yml', text)), String(permissions)).toEqual([
        'permissions',
      ]);
    }
  });

  it('an extra top-level permission fails', () => {
    const text = workflow({ permissions: 'permissions:\n  contents: read\n  issues: write' });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['permissions']);
  });

  it('an action pinned by tag fails', () => {
    const text = workflow({ job: job(BASE_JOB, ['      - uses: actions/checkout@v5']) });
    expect(checkWorkflowText('sample.yml', text)).toEqual([
      {
        file: 'sample.yml',
        rule: 'pin',
        message: 'actions/checkout@v5 is not pinned to a commit SHA',
      },
    ]);
  });

  it('an upper-case or short SHA fails', () => {
    for (const ref of [SHA_A.toUpperCase(), SHA_A.slice(0, 12)]) {
      const text = workflow({ job: job(BASE_JOB, [`      - uses: actions/checkout@${ref} # v1`]) });
      expect(rules(checkWorkflowText('sample.yml', text)), ref).toEqual(['pin']);
    }
  });

  it('pull_request_target fails', () => {
    for (const on of [
      'on: [pull_request_target]',
      'on:\n  pull_request_target:\n    types: [opened]',
      'on: pull_request_target',
    ]) {
      expect(rules(checkWorkflowText('sample.yml', workflow({ on }))), on).toEqual(['trigger']);
    }
  });

  it('a job without timeout-minutes fails', () => {
    const text = workflow({ job: job(['runs-on: ubuntu-24.04']) });
    const violations = checkWorkflowText('sample.yml', text);
    expect(rules(violations)).toEqual(['timeout']);
    expect(violations[0]?.message).toContain('job build');
  });

  it('a timeout that is not a positive integer fails', () => {
    for (const value of ['0', '2.5', "'10'", '-1']) {
      const text = workflow({ job: job(['runs-on: ubuntu-24.04', `timeout-minutes: ${value}`]) });
      expect(rules(checkWorkflowText('sample.yml', text)), value).toEqual(['timeout']);
    }
  });

  it('a pinned action without its version comment fails', () => {
    for (const line of [
      `      - uses: actions/checkout@${SHA_A}`,
      `      - uses: actions/checkout@${SHA_A} # latest`,
    ]) {
      const text = workflow({ job: job(BASE_JOB, [line]) });
      expect(checkWorkflowText('sample.yml', text), line).toEqual([
        {
          file: 'sample.yml',
          rule: 'pin',
          message: `actions/checkout@${SHA_A} has no "# v<version>" comment`,
        },
      ]);
    }
  });

  it('every line of a repeated action needs its comment', () => {
    const steps = [CHECKOUT, `      - uses: actions/checkout@${SHA_A}`];
    const text = workflow({ job: job(BASE_JOB, steps) });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['pin']);
  });

  it('a pinned sub-path action and a local action pass', () => {
    const steps = [
      `      - uses: github/codeql-action/init@${SHA_B} # v3.1.0`,
      '      - uses: ./.github/actions/setup',
    ];
    expect(checkWorkflowText('sample.yml', workflow({ job: job(BASE_JOB, steps) }))).toEqual([]);
  });

  it('a docker image without a digest fails', () => {
    const text = workflow({ job: job(BASE_JOB, ['      - uses: docker://alpine:3']) });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['pin']);
    const pinned = workflow({
      job: job(BASE_JOB, [`      - uses: docker://alpine:3@sha256:${'ab'.repeat(32)}`]),
    });
    expect(checkWorkflowText('sample.yml', pinned)).toEqual([]);
  });

  it('a reusable workflow at job level is checked for its pin', () => {
    const text = workflow({
      job: '  call:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    uses: owner/repo/.github/workflows/x.yml@main',
    });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['pin']);
  });

  it('another runner fails', () => {
    for (const runner of ['ubuntu-latest', '[self-hosted]', 'ubuntu-22.04']) {
      const text = workflow({ job: job([`runs-on: ${runner}`, 'timeout-minutes: 5']) });
      expect(rules(checkWorkflowText('sample.yml', text)), runner).toEqual(['runner']);
    }
  });

  it('a write permission outside the allow-list fails', () => {
    for (const permission of ['contents: write', 'id-token: write']) {
      const text = workflow({
        job: job([...BASE_JOB, 'permissions:', `  ${permission}`]),
      });
      expect(rules(checkWorkflowText('sample.yml', text)), permission).toEqual(['job-permissions']);
    }
    const allowed = workflow({
      job: job([...BASE_JOB, 'permissions:', '  pull-requests: write', '  actions: read']),
    });
    expect(checkWorkflowText('sample.yml', allowed)).toEqual([]);
  });

  it('a job permission given as a string fails', () => {
    const text = workflow({ job: job([...BASE_JOB, 'permissions: read-all']) });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['job-permissions']);
  });

  it('a scheduled workflow needs dispatch, no push, a non-zero minute and its own concurrency', () => {
    expect(checkWorkflowText('nightly.yml', scheduled())).toEqual([]);
    const cases = [
      scheduled({ on: "on:\n  schedule:\n    - cron: '17 7 * * *'" }),
      scheduled({
        on: "on:\n  schedule:\n    - cron: '17 7 * * *'\n  workflow_dispatch:\n  push:\n    branches: [main]",
      }),
      scheduled({ on: "on:\n  schedule:\n    - cron: '0 7 * * *'\n  workflow_dispatch:" }),
      scheduled({ concurrency: 'concurrency:\n  group: other\n  cancel-in-progress: false' }),
      scheduled({ concurrency: 'concurrency:\n  group: nightly\n  cancel-in-progress: true' }),
    ];
    for (const text of cases) {
      expect(rules(checkWorkflowText('nightly.yml', text)), text).toEqual(['schedule']);
    }
    const noConcurrency = rules(checkWorkflowText('nightly.yml', scheduled({ concurrency: null })));
    expect(noConcurrency).toEqual(['schedule', 'schedule']);
  });

  it('a cron that can fire at minute 0 fails and others pass', () => {
    const withCron = (cron: string): string =>
      scheduled({ on: `on:\n  schedule:\n    - cron: '${cron}'\n  workflow_dispatch:` });
    expect(rules(checkWorkflowText('nightly.yml', withCron('*/5 * * * *')))).toEqual(['schedule']);
    expect(rules(checkWorkflowText('nightly.yml', withCron('* * * * *')))).toEqual(['schedule']);
    expect(checkWorkflowText('nightly.yml', withCron('3-59/10 * * * *'))).toEqual([]);
    expect(checkWorkflowText('nightly.yml', withCron('19 7 * * 1'))).toEqual([]);
  });

  it('a secret outside an Environment fails', () => {
    const step = (name: string): string[] => [
      CHECKOUT,
      '      - run: echo deploy',
      '        env:',
      `          TOKEN: \${{ secrets.${name} }}`,
    ];
    const bare = workflow({ job: job(BASE_JOB, step('RAILWAY_TOKEN_STAGING')) });
    expect(rules(checkWorkflowText('sample.yml', bare))).toEqual(['secrets']);
    const inEnvironment = workflow({
      job: job([...BASE_JOB, 'environment: staging'], step('RAILWAY_TOKEN_STAGING')),
    });
    expect(checkWorkflowText('sample.yml', inEnvironment)).toEqual([]);
    const githubToken = workflow({ job: job(BASE_JOB, step('GITHUB_TOKEN')) });
    expect(checkWorkflowText('sample.yml', githubToken)).toEqual([]);
  });

  it('a secret read by index outside an Environment fails', () => {
    const steps = [CHECKOUT, "      - run: echo ${{ secrets['RAILWAY_TOKEN_STAGING'] }}"];
    const text = workflow({ job: job(BASE_JOB, steps) });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['secrets']);
  });

  it('ci.yml may use no secret', () => {
    const steps = [CHECKOUT, '      - run: echo ${{ secrets.EXPO_TOKEN }}'];
    const text = workflow({ job: job([...BASE_JOB, 'environment: staging'], steps) });
    expect(rules(checkWorkflowText('.github/workflows/ci.yml', text))).toEqual(['ci-secrets']);
    expect(checkWorkflowText('.github/workflows/eas.yml', text)).toEqual([]);
  });

  it('a file that does not parse or lacks a section fails', () => {
    expect(rules(checkWorkflowText('bad.yml', 'name: [unclosed\n'))).toEqual(['parse']);
    expect(rules(checkWorkflowText('bad.yml', 'name: x\non: push\n'))).toEqual(['parse']);
    expect(rules(checkWorkflowText('bad.yml', '- a\n- b\n'))).toEqual(['parse']);
  });

  it('keeps the key on as a string (YAML 1.2)', () => {
    const text = workflow({ on: 'on:\n  pull_request_target:' });
    expect(rules(checkWorkflowText('sample.yml', text))).toEqual(['trigger']);
  });
});

describe('checkActionText', () => {
  const action = (step: string): string =>
    `name: setup\ndescription: x\nruns:\n  using: composite\n  steps:\n${step}\n      with:\n        a: b\n`;

  it('checks the pins of a composite action', () => {
    expect(
      checkActionText('action.yml', action(`    - uses: pnpm/action-setup@${SHA_B} # v6.1.1`)),
    ).toEqual([]);
    expect(
      rules(checkActionText('action.yml', action('    - uses: pnpm/action-setup@v6'))),
    ).toEqual(['pin']);
    expect(
      rules(checkActionText('action.yml', action(`    - uses: pnpm/action-setup@${SHA_B}`))),
    ).toEqual(['pin']);
  });

  it('an action without runs fails', () => {
    expect(rules(checkActionText('action.yml', 'name: x\n'))).toEqual(['parse']);
  });
});

describe('cronMinutes', () => {
  it('cronMinutes expands the minute field', () => {
    expect(cronMinutes('17')).toEqual([17]);
    expect(cronMinutes('3-59/10')).toEqual([3, 13, 23, 33, 43, 53]);
    expect(cronMinutes('*/30')).toEqual([0, 30]);
    expect(cronMinutes('5,35')).toEqual([5, 35]);
    expect(cronMinutes('10-12')).toEqual([10, 11, 12]);
    expect(cronMinutes('*')).toHaveLength(60);
  });

  it('refuses a field it cannot read', () => {
    for (const field of ['60', 'x', '*/0', '9-3', '1/2/3', '']) {
      expect(() => cronMinutes(field), field).toThrow();
    }
  });
});

describe('the repository', () => {
  it("the repository's workflows and actions pass", () => {
    const root = repoRoot();
    const { workflows, actions } = workflowFiles(root);
    expect(workflows).toContain('.github/workflows/ci.yml');
    expect(actions).toContain('.github/actions/setup/action.yml');
    const violations = [
      ...workflows.flatMap((file) =>
        checkWorkflowText(file, readFileSync(join(root, file), 'utf8')),
      ),
      ...actions.flatMap((file) => checkActionText(file, readFileSync(join(root, file), 'utf8'))),
    ];
    expect(violations).toEqual([]);
  });
});
