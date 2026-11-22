import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, inject, it } from 'vitest';
import { runMigrations } from './migrator.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  harnessSettings,
} from './testing/settings.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

type Exit = { code: number | null; lines: Record<string, unknown>[]; output: string };

// Runs the runner's command as the deploy does. `env` adds variables to the test environment,
// which the allow-list has already stripped of DATABASE_URL.
function runCommand(variables: readonly string[]): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn('env', [...variables, 'pnpm', 'exec', 'tsx', 'src/migrate.ts'], {
      cwd: PACKAGE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = output
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => {
          const value: unknown = JSON.parse(line);
          return typeof value === 'object' && value !== null
            ? Object.fromEntries(Object.entries(value))
            : {};
        });
      resolve({ code, lines, output });
    });
  });
}

describe('the migrate command', () => {
  it('exits 0 when there is nothing to do', async () => {
    const { databaseUrl } = harnessSettings();
    const name = `os_mig_${inject('harness').runId}_cmd`;
    const admin = await connectHarnessClient(databaseUrl, 'os-test-migrate');
    try {
      await admin.query(`create database ${admin.escapeIdentifier(name)}`);
      const url = databaseUrlFor(databaseUrl, name);
      await runMigrations(url);

      const exit = await runCommand([`DATABASE_URL=${url}`]);
      expect(exit.code).toBe(0);
      expect(exit.lines.at(-1)).toMatchObject({ event: 'migrate.done', applied: 0 });
      expect(exit.output).not.toContain(url);
    } finally {
      await dropDatabase(admin, name);
      await admin.end();
    }
  });

  it('exits 2 without DATABASE_URL', async () => {
    const exit = await runCommand([]);
    expect(exit.code).toBe(2);
    expect(exit.lines).toHaveLength(1);
    expect(exit.lines[0]).toMatchObject({
      event: 'migrate.env_invalid',
      variables: ['DATABASE_URL'],
    });
  });
});
