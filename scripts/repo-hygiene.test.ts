import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { checkActionText, checkWorkflowText, workflowFiles } from './check-workflows.ts';
import { mediaCorsRules } from './lib/cors.ts';
import { repoRoot } from './lib/repo-root.ts';

// TEST-repo-hygiene: the repository is public, so these facts are checked on every run.

const ROOT = repoRoot();
const THIS_FILE = 'scripts/repo-hygiene.test.ts';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** The repository's files: tracked, plus untracked files git does not ignore. */
function repositoryFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path !== '');
}

/** Every string literal and template text of a TypeScript source. */
function stringLiterals(source: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard);
  scanner.setText(source);
  const literals: string[] = [];
  const braces: ('template' | 'block')[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.OpenBraceToken) {
      braces.push('block');
    } else if (token === ts.SyntaxKind.CloseBraceToken) {
      if (braces.pop() === 'template') {
        token = scanner.reScanTemplateToken(false);
        literals.push(scanner.getTokenValue());
        if (token === ts.SyntaxKind.TemplateMiddle) {
          braces.push('template');
        }
      }
    } else if (token === ts.SyntaxKind.TemplateHead) {
      literals.push(scanner.getTokenValue());
      braces.push('template');
    } else if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      literals.push(scanner.getTokenValue());
    }
  }
  return literals;
}

const KEY_RUN = /[A-Za-z0-9+/=_-]{21,}/g;
const IMAGE_DIGEST = /sha256:[0-9a-f]{64}/g;

/** The key-shaped runs and private-key markers in a TypeScript source's string literals (D-116). */
function keyShapedLiterals(source: string): string[] {
  const found: string[] = [];
  for (const literal of stringLiterals(source)) {
    if (literal.includes('-----BEGIN')) {
      found.push(literal);
    }
    const withoutDigests = literal.replace(IMAGE_DIGEST, 'sha256:');
    for (const [run] of withoutDigests.matchAll(KEY_RUN)) {
      if (/[A-Za-z]/.test(run) && /[0-9]/.test(run)) {
        found.push(run);
      }
    }
  }
  return found;
}

const BANNED_TEST_LINE = new RegExp(
  ['^\\s*(?:it|test|describe)\\.(?:only|skip|', 'todo', ')\\(|^\\s*(?:xit|xdescribe)\\('].join(''),
);

describe('repository hygiene', () => {
  it('node versions agree', () => {
    const nvmrc = read('.nvmrc').trim();
    const images = z.object({ node: z.string() }).parse(JSON.parse(read('docker/images.json')));
    const eas = z
      .object({ build: z.object({ base: z.object({ node: z.string() }) }) })
      .parse(JSON.parse(read('apps/mobile/eas.json')));
    expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
    expect(/^node:(\d+\.\d+\.\d+)-/.exec(images.node)?.[1]).toBe(nvmrc);
    expect(eas.build.base.node).toBe(nvmrc);
  });

  it('local CORS equals Railway CORS', () => {
    const local: unknown = JSON.parse(read('docker/seaweedfs/cors.json'));
    expect(local).toStrictEqual(mediaCorsRules(['http://localhost:8081', 'http://localhost:8080']));
  });

  it('every action is pinned by SHA', () => {
    const { workflows, actions } = workflowFiles(ROOT);
    expect(workflows.length).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
    const pins = [
      ...workflows.flatMap((file) => checkWorkflowText(file, read(file))),
      ...actions.flatMap((file) => checkActionText(file, read(file))),
    ].filter((violation) => violation.rule === 'pin');
    expect(pins).toEqual([]);
  });

  it('no unsafe triggers', () => {
    const { workflows } = workflowFiles(ROOT);
    const unsafe = workflows
      .flatMap((file) => checkWorkflowText(file, read(file)))
      .filter((violation) => violation.rule === 'trigger');
    expect(unsafe).toEqual([]);
    const scheduled = workflows.filter((file) => /^\s{2}schedule:/m.test(read(file)));
    expect(scheduled).toContain('.github/workflows/nightly.yml');
    const broken = scheduled
      .flatMap((file) => checkWorkflowText(file, read(file)))
      .filter((violation) => violation.rule === 'schedule' || violation.rule === 'timeout');
    expect(broken).toEqual([]);
  });

  it('no secret in railway.ts', () => {
    expect(keyShapedLiterals(read('.railway/railway.ts'))).toEqual([]);
    // The helper finds a key-shaped literal, so the check above cannot pass vacuously.
    const sample = 'abc123'.repeat(5);
    expect(keyShapedLiterals(`const a = '${sample}';`)).toEqual([sample]);
    expect(keyShapedLiterals(`const a = \`x \${b} ${sample}\`;`)).toEqual([sample]);
    expect(keyShapedLiterals(`const a = "${'-'.repeat(5)}BEGIN PRIVATE KEY";`)).toHaveLength(1);
    expect(keyShapedLiterals(`const a = 'image@sha256:${'ab12'.repeat(16)}';`)).toEqual([]);
    expect(keyShapedLiterals(`// ${sample}\nconst a = 1;`)).toEqual([]);
  });

  it('no skipped or focused test', () => {
    const testFile = /(\.test\.tsx?|\.int\.test\.ts|\.spec\.ts)$/;
    const files = repositoryFiles().filter(
      (path) =>
        testFile.test(path) &&
        path !== THIS_FILE &&
        !path.startsWith('scripts/eslint/') &&
        !path.split('/').some((segment) => segment === 'node_modules' || segment === 'dist'),
    );
    expect(files).toContain('scripts/ci-local.test.ts');
    const offenders = files.flatMap((path) =>
      read(path)
        .split('\n')
        .flatMap((line, index) =>
          BANNED_TEST_LINE.test(line) ? [`${path}:${String(index + 1)}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
    // The pattern catches each banned form.
    for (const sample of [
      "it.only('x', () => {});",
      "  test.skip('x', () => {});",
      "describe.todo('x');",
      "xit('x', () => {});",
      "    xdescribe('x', () => {});",
    ]) {
      expect(BANNED_TEST_LINE.test(sample), sample).toBe(true);
    }
    expect(BANNED_TEST_LINE.test("it('runs only once', () => {});")).toBe(false);
  });

  it('no build context holds credential files or the agent folder', () => {
    const gitignore = read('.gitignore').split('\n');
    const start = gitignore.indexOf('# credentials and signing material');
    const end = gitignore.indexOf('', start);
    const credentials = gitignore.slice(start + 1, end);
    expect(credentials).toContain('*.pem');
    for (const file of ['.dockerignore', 'docker/e2e.Dockerfile.dockerignore']) {
      const lines = read(file).split('\n');
      for (const pattern of credentials) {
        expect(lines, `${file} lacks **/${pattern}`).toContain(`**/${pattern}`);
      }
      expect(lines).toEqual(expect.arrayContaining(['.claude', 'CLAUDE.md', '**/*.dump']));
    }
  });

  it('the local database listens on the loopback address only', () => {
    const compose = z
      .object({
        services: z.object({ postgres: z.object({ ports: z.array(z.string()).min(1) }) }),
      })
      .parse(parse(read('docker-compose.yml')));
    for (const port of compose.services.postgres.ports) {
      expect(port.startsWith('127.0.0.1:'), port).toBe(true);
    }
  });

  it('the shell does not leak into tests', { timeout: 60000 }, () => {
    const child = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--config', 'scripts/__fixtures__/env-leak/vitest.config.ts'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          RESEND_API_KEY: 're_fixture',
          ANTHROPIC_API_KEY: 'sk-fixture',
          NO_COLOR: '1',
        },
      },
    );
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    expect(child.stdout).toMatch(/Tests\s+1 passed/);
  });
});
