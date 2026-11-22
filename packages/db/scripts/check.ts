// `pnpm check:db` (D-235): the Drizzle schema and the SQL migrations must agree. Runs
// `drizzle-kit check`, then `drizzle-kit generate --name=drift_check`; anything that generate
// writes is drift, so it is deleted again and the check fails.
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(PACKAGE_DIR, 'migrations');
const DRIZZLE_KIT = join(PACKAGE_DIR, 'node_modules', '.bin', 'drizzle-kit');

function run(args: readonly string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(DRIZZLE_KIT, args, { cwd: PACKAGE_DIR, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

function listMigrations(): Set<string> {
  return new Set(readdirSync(MIGRATIONS_DIR));
}

async function main(): Promise<number> {
  const checked = await run(['check']);
  if (checked !== 0) {
    process.stderr.write('drizzle-kit check failed\n');
    return 1;
  }

  const before = listMigrations();
  const generated = await run(['generate', '--name=drift_check']);
  const added = [...listMigrations()].filter((name) => !before.has(name)).sort();
  for (const name of added) {
    rmSync(join(MIGRATIONS_DIR, name), { recursive: true, force: true });
  }
  if (added.length > 0) {
    process.stderr.write('drizzle schema and SQL migrations differ\n');
    for (const name of added) {
      process.stderr.write(`  ${name}\n`);
    }
    return 1;
  }
  if (generated !== 0) {
    process.stderr.write('drizzle-kit generate failed\n');
    return 1;
  }
  process.stdout.write('drizzle schema and SQL migrations agree\n');
  return 0;
}

process.exitCode = await main();
