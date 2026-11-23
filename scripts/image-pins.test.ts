import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { repoRoot } from './lib/repo-root.ts';

// docker/images.json is the one record of every pinned image; Dockerfiles, compose, workflows
// and the Railway file repeat its strings, and this test keeps the copies equal (D-021, D-150).

const ROOT = repoRoot();

const PinsSchema = z.strictObject({
  node: z.string(),
  postgis: z.string(),
  seaweedfs: z.string(),
  awscli: z.string(),
  playwright: z.string(),
});
type Pins = z.infer<typeof PinsSchema>;

type SourceFile = { path: string; text: string };

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function pins(): Pins {
  return PinsSchema.parse(JSON.parse(read('docker/images.json')));
}

/** The repository-relative paths of the files in a folder whose names end in the suffix. */
function filesIn(dir: string, suffix: string): string[] {
  if (!existsSync(join(ROOT, dir))) {
    return [];
  }
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => `${dir}/${name}`);
}

function sources(paths: readonly string[]): SourceFile[] {
  return paths
    .filter((path) => existsSync(join(ROOT, path)))
    .map((path) => ({ path, text: read(path) }));
}

function dockerfiles(): SourceFile[] {
  return sources(filesIn('docker', '.Dockerfile'));
}

/** Every value of `ARG <name>=` in the files, with the file it came from. */
function argValues(files: readonly SourceFile[], name: string): { path: string; value: string }[] {
  const pattern = new RegExp(`^ARG ${name}=(.*)$`, 'gm');
  return files.flatMap((file) =>
    [...file.text.matchAll(pattern)].map((match) => ({
      path: file.path,
      value: (match[1] ?? '').trim(),
    })),
  );
}

/** The version in `node:<version>-trixie-slim@sha256:...`. */
function nodeVersionOf(image: string): string | null {
  return /^node:(\d+\.\d+\.\d+)-trixie-slim@sha256:[0-9a-f]{64}$/.exec(image)?.[1] ?? null;
}

const REFERENCE_PATTERNS: readonly { key: keyof Pins; pattern: RegExp }[] = [
  { key: 'postgis', pattern: /postgis\/postgis[^\s'"`,)]*/g },
  { key: 'seaweedfs', pattern: /chrislusf\/seaweedfs[^\s'"`,)]*/g },
  { key: 'awscli', pattern: /amazon\/aws-cli[^\s'"`,)]*/g },
  // An image reference carries a version tag; `node:fs` and other built-in specifiers do not.
  { key: 'node', pattern: /(?<![\w./-])node:\d[^\s'"`,)]*/g },
  { key: 'playwright', pattern: /mcr\.microsoft\.com\/playwright[^\s'"`,)]*/g },
];

/** Each image reference in the files that differs from its pin, as `<file>: <found> (pin <pin>)`. */
function staleReferences(files: readonly SourceFile[], pinned: Pins): string[] {
  const stale: string[] = [];
  for (const file of files) {
    for (const { key, pattern } of REFERENCE_PATTERNS) {
      for (const match of file.text.matchAll(pattern)) {
        if (match[0] !== pinned[key]) {
          stale.push(`${file.path}: ${match[0]} (pin ${pinned[key]})`);
        }
      }
    }
  }
  return stale;
}

describe('image pins', () => {
  it('keeps the node version equal in images.json, .nvmrc and eas.json', () => {
    const version = nodeVersionOf(pins().node);
    expect(version).not.toBeNull();
    expect(read('.nvmrc').trim()).toBe(version);
    const eas = z
      .object({ build: z.object({ base: z.object({ node: z.string() }) }) })
      .parse(JSON.parse(read('apps/mobile/eas.json')));
    expect(eas.build.base.node).toBe(version);
  });

  it('sets every NODE_IMAGE argument to the node pin', () => {
    const values = argValues(dockerfiles(), 'NODE_IMAGE');
    expect(values.length).toBeGreaterThanOrEqual(3);
    const node = pins().node;
    expect(values.filter((entry) => entry.value !== node)).toEqual([]);
  });

  it('sets every PLAYWRIGHT_IMAGE argument to the playwright pin', () => {
    const playwright = pins().playwright;
    const values = argValues(dockerfiles(), 'PLAYWRIGHT_IMAGE');
    expect(values.filter((entry) => entry.value !== playwright)).toEqual([]);
  });

  it('sets every PNPM_VERSION argument to the packageManager version', () => {
    const manifest = z
      .object({ packageManager: z.string() })
      .parse(JSON.parse(read('package.json')));
    const version = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)?.[1];
    expect(version).toBeDefined();
    const values = argValues(dockerfiles(), 'PNPM_VERSION');
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.filter((entry) => entry.value !== version)).toEqual([]);
  });

  it('keeps image references in compose, workflows and the Railway file equal to their pins', () => {
    const files = sources([
      'docker-compose.yml',
      ...filesIn('.github/workflows', '.yml'),
      '.railway/railway.ts',
    ]);
    expect(files.map((file) => file.path)).toContain('docker-compose.yml');
    expect(staleReferences(files, pins())).toEqual([]);
  });

  it('names the stale file when a reference differs from its pin', () => {
    const pinned = pins();
    const stale = staleReferences(
      [
        { path: 'docker-compose.yml', text: `    image: ${pinned.postgis}\n` },
        {
          path: '.github/workflows/ci.yml',
          text: "    container: mcr.microsoft.com/playwright:v0.0.1-noble\n    image: 'node:24.0.0-trixie-slim'\n",
        },
        { path: '.railway/railway.ts', text: "import { readFileSync } from 'node:fs';\n" },
      ],
      pinned,
    );
    expect(stale).toEqual([
      `.github/workflows/ci.yml: node:24.0.0-trixie-slim (pin ${pinned.node})`,
      `.github/workflows/ci.yml: mcr.microsoft.com/playwright:v0.0.1-noble (pin ${pinned.playwright})`,
    ]);
  });

  it('keeps the playwright tag equal to the installed @playwright/test', () => {
    const resolver = createRequire(join(ROOT, 'apps/mobile/package.json'));
    const manifest = resolver.resolve('@playwright/test/package.json');
    const installed = z
      .object({ version: z.string() })
      .parse(JSON.parse(readFileSync(manifest, 'utf8')));
    expect(pins().playwright).toBe(`mcr.microsoft.com/playwright:v${installed.version}-noble`);
  });

  it('pins every image but playwright by digest', () => {
    const pinned = pins();
    for (const key of ['node', 'postgis', 'seaweedfs', 'awscli'] as const) {
      expect(pinned[key], key).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });
});
