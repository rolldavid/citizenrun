import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flakyTests, main, warningLine } from './flake-report.ts';

/** A Playwright JSON report in the shape the reporter writes: suites, nested suites, specs, tests. */
const REPORT = {
  config: {},
  suites: [
    {
      title: 'hello.spec.ts',
      file: 'e2e/web/hello.spec.ts',
      specs: [
        {
          title: 'loads the page',
          file: 'e2e/web/hello.spec.ts',
          tests: [{ projectName: 'phone-light', status: 'expected' }],
        },
      ],
      suites: [
        {
          title: 'the hello screen',
          file: 'e2e/web/hello.spec.ts',
          specs: [
            {
              title: 'shows the hello screen',
              file: 'e2e/web/hello.spec.ts',
              tests: [
                { projectName: 'phone-light', status: 'expected' },
                { projectName: 'phone-dark', status: 'flaky' },
              ],
            },
            {
              title: 'fails',
              file: 'e2e/web/hello.spec.ts',
              tests: [{ projectName: 'desktop-light', status: 'unexpected' }],
            },
          ],
        },
      ],
    },
  ],
};

let folder: string | null = null;

function tempFolder(): string {
  folder = mkdtempSync(join(tmpdir(), 'flake-report-'));
  return folder;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (folder !== null) {
    rmSync(folder, { recursive: true, force: true });
    folder = null;
  }
});

describe('flakyTests', () => {
  it('returns exactly the flaky test with its file, title and project', () => {
    expect(flakyTests(REPORT)).toEqual([
      { file: 'e2e/web/hello.spec.ts', title: 'shows the hello screen', project: 'phone-dark' },
    ]);
  });

  it('returns nothing for a report with no suites', () => {
    expect(flakyTests({ suites: [] })).toEqual([]);
    expect(flakyTests({})).toEqual([]);
    expect(flakyTests(null)).toEqual([]);
  });

  it('keeps report order across suites', () => {
    const report = {
      suites: [
        {
          specs: [
            { title: 'one', file: 'a.spec.ts', tests: [{ projectName: 'p', status: 'flaky' }] },
          ],
        },
        {
          specs: [
            { title: 'two', file: 'b.spec.ts', tests: [{ projectName: 'q', status: 'flaky' }] },
          ],
        },
      ],
    };
    expect(flakyTests(report).map((test) => test.title)).toEqual(['one', 'two']);
  });
});

describe('warningLine', () => {
  it('writes a GitHub warning naming the file, title and project', () => {
    expect(
      warningLine({
        file: 'e2e/web/hello.spec.ts',
        title: 'shows the hello screen',
        project: 'phone-dark',
      }),
    ).toBe(
      '::warning title=Flaky test::e2e/web/hello.spec.ts > shows the hello screen [phone-dark]',
    );
  });
});

describe('main', () => {
  it('resolves 0 when the report is missing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const missing = join(tempFolder(), 'missing.json');
    await expect(main(['--report', missing])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(`flake-report: no report at ${missing}`);
  });

  it('prints one warning per flaky test and the count, and resolves 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = join(tempFolder(), 'results.json');
    writeFileSync(path, JSON.stringify(REPORT));
    await expect(main(['--report', path])).resolves.toBe(0);
    expect(log.mock.calls.map((call) => call[0])).toEqual([
      '::warning title=Flaky test::e2e/web/hello.spec.ts > shows the hello screen [phone-dark]',
      'flake-report: 1 flaky',
    ]);
  });

  it('resolves 1 when the report cannot be parsed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const path = join(tempFolder(), 'results.json');
    writeFileSync(path, '{ not json');
    await expect(main(['--report', path])).resolves.toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(
      /^flake-report: cannot read .*results\.json: /,
    );
  });
});
