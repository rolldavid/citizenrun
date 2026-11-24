// Flaky end-to-end tests made visible (TEST-flake-report):
//   tsx scripts/flake-report.ts [--report <path>]
// Reads Playwright's JSON report and prints one GitHub warning line per test that passed only on
// a retry. It exits 0 whatever it finds, since the suite's own exit code already says whether it
// failed, and 1 only when the report cannot be read.
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/repo-root.ts';

export type FlakyTest = { file: string; title: string; project: string };

const DEFAULT_REPORT = 'apps/mobile/test-results/results.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Every test of the report whose status is `flaky`, with its spec's file and title, in report order. */
export function flakyTests(report: unknown): FlakyTest[] {
  const found: FlakyTest[] = [];
  const walk = (suite: Record<string, unknown>): void => {
    for (const spec of records(suite.specs)) {
      for (const test of records(spec.tests)) {
        if (test.status === 'flaky') {
          found.push({
            file: text(spec.file),
            title: text(spec.title),
            project: text(test.projectName),
          });
        }
      }
    }
    for (const child of records(suite.suites)) {
      walk(child);
    }
  };
  if (isRecord(report)) {
    for (const suite of records(report.suites)) {
      walk(suite);
    }
  }
  return found;
}

export function warningLine(test: FlakyTest): string {
  return `::warning title=Flaky test::${test.file} > ${test.title} [${test.project}]`;
}

export async function main(argv: readonly string[]): Promise<number> {
  let reportPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--report' && value !== undefined && value !== '') {
      reportPath = value;
      index += 1;
    } else {
      console.error('usage: tsx scripts/flake-report.ts [--report <path>]');
      return 2;
    }
  }
  const path =
    reportPath === null ? resolve(repoRoot(), DEFAULT_REPORT) : resolve(process.cwd(), reportPath);
  reportPath ??= DEFAULT_REPORT;
  if (!existsSync(path)) {
    console.log(`flake-report: no report at ${reportPath}`);
    return 0;
  }
  let report: unknown;
  try {
    report = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error(`flake-report: cannot read ${reportPath}: ${reason}`);
    return 1;
  }
  const flaky = flakyTests(report);
  for (const test of flaky) {
    console.log(warningLine(test));
  }
  console.log(`flake-report: ${String(flaky.length)} flaky`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
