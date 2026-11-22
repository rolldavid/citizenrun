import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';

/** The generated locations; each is committed, and a difference after `pnpm gen` is drift. */
export const GENERATED_PATHS: readonly string[] = [
  'packages/shared/src/api/',
  'packages/shared/src/brand.ts',
  'apps/mobile/native-strings.en.json',
  'apps/api/openapi.json',
  'packages/cards/src/generated/',
  'packages/cards/src/font-metrics.json',
  'packages/shared/src/legal/source-credits.ts',
  'apps/api/assets/map/',
];

function isGenerated(path: string): boolean {
  return GENERATED_PATHS.some((generated) =>
    generated.endsWith('/') ? path.startsWith(generated) : path === generated,
  );
}

function unquote(path: string): string {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/** The paths of `git status --porcelain` lines (changed, added, deleted or untracked) under the generated locations. */
export function changedGeneratedPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) {
      continue;
    }
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    for (const path of arrow === -1 ? [rest] : [rest.slice(0, arrow), rest.slice(arrow + 4)]) {
      const clean = unquote(path.trim());
      if (isGenerated(clean) && !paths.includes(clean)) {
        paths.push(clean);
      }
    }
  }
  return paths;
}

/** Runs every generator and fails when a generated file changed; the new files stay in place. */
export async function main(): Promise<number> {
  const root = repoRoot();
  const generated = await run('pnpm', ['gen'], { cwd: root, inherit: true });
  if (generated.code !== 0) {
    console.error('pnpm gen failed');
    return 1;
  }
  const status = await run(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...GENERATED_PATHS],
    { cwd: root },
  );
  if (status.code !== 0) {
    console.error(status.stderr.trim());
    return 1;
  }
  const changed = changedGeneratedPaths(status.stdout);
  for (const file of changed) {
    console.log(`generated file differs from its source: ${file}`);
  }
  return changed.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
