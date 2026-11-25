import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, RESERVED_HANDLE_WORDS } from '@citizenrun/shared';
import { repoRoot } from './lib/repo-root.ts';

// TEST-handle-rules: every top-level route segment of the app is a reserved handle word, so a handle
// can never shadow a route, and the brand's display name is reserved.

const APP_DIR = join(repoRoot(), 'apps', 'mobile', 'app');
const ROUTE_FILE = /\.tsx?$/;
const GROUP = /^\(.*\)$/;
const DYNAMIC = /^\[.*\]$/;
const SEPARATORS = /[-_.]/g;

/** Every file under a folder, as paths relative to it with `/` separators. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** The first URL segment of a route file, or null when the file adds none. */
function topSegment(file: string): string | null {
  const segments = file
    .replace(ROUTE_FILE, '')
    .split('/')
    .filter((segment) => !GROUP.test(segment));
  const last = segments[segments.length - 1];
  if (last === undefined || last === '_layout' || last.startsWith('+')) {
    return null;
  }
  const first = segments[0];
  if (first === undefined || first === 'index' || DYNAMIC.test(first)) {
    return null;
  }
  return first;
}

function normalise(word: string): string {
  return word.toLowerCase().replace(SEPARATORS, '');
}

/** The top-level route segments not covered by the reserved words, after normalising both sides. */
function unreservedSegments(segments: readonly string[], words: Iterable<string>): string[] {
  const reserved = new Set([...words].map(normalise));
  return segments.filter((segment) => !reserved.has(normalise(segment)));
}

const ROUTE_SEGMENTS = [
  ...new Set(
    listFiles(APP_DIR)
      .filter((file) => ROUTE_FILE.test(file))
      .map(topSegment)
      .filter((segment): segment is string => segment !== null),
  ),
].sort();

describe('reserved handles', () => {
  it('every top-level route segment is reserved', () => {
    expect(ROUTE_SEGMENTS.length).toBeGreaterThan(0);
    for (const segment of ROUTE_SEGMENTS) {
      expect(
        unreservedSegments([segment], RESERVED_HANDLE_WORDS),
        `route segment ${segment}`,
      ).toEqual([]);
    }
  });

  it("the brand's display name is reserved", () => {
    expect(RESERVED_HANDLE_WORDS.has(BRAND.displayName.toLowerCase())).toBe(true);
  });

  it('reads route segments the way the router builds URLs', () => {
    expect(topSegment('(tabs)/explore.tsx')).toBe('explore');
    expect(topSegment('(tabs)/(home)/settings/delete-account.tsx')).toBe('settings');
    expect(topSegment('_layout.tsx')).toBeNull();
    expect(topSegment('settings/_layout.tsx')).toBeNull();
    expect(topSegment('+not-found.tsx')).toBeNull();
    expect(topSegment('index.tsx')).toBeNull();
    expect(topSegment('(tabs)/index.tsx')).toBeNull();
    expect(topSegment('[slug].tsx')).toBeNull();
    expect(topSegment('dev/screens/[screen]/[fixture].tsx')).toBe('dev');
  });

  it('reports a segment that is not reserved', () => {
    expect(unreservedSegments(['zzz-check', 'sign-in', 'Settings'], RESERVED_HANDLE_WORDS)).toEqual(
      ['zzz-check'],
    );
  });
});
