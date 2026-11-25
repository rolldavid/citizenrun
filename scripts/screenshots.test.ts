import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  USAGE,
  UsageError,
  captureImages,
  parseScreenshotArgs,
  removeStaleParts,
  screenshotEnv,
  staleParts,
} from './screenshots.ts';

describe('parseScreenshotArgs', () => {
  it('makes the folder absolute and keeps the routes and the build', () => {
    expect(parseScreenshotArgs(['--out', 'shots', '--routes', 'a,b'], '/repo')).toEqual({
      out: '/repo/shots',
      routes: ['a', 'b'],
      baseUrl: null,
      build: true,
    });
  });

  it('keeps an absolute folder as it is', () => {
    expect(parseScreenshotArgs(['--out', '/tmp/shots'], '/repo').out).toBe('/tmp/shots');
  });

  it('turns the build off with a base URL and passes the URL on', () => {
    const args = parseScreenshotArgs(
      ['--out', 'shots', '--base-url', 'http://localhost:9999'],
      '/repo',
    );
    expect(args.build).toBe(false);
    expect(args.baseUrl).toBe('http://localhost:9999');
    expect(screenshotEnv(args).SCREENS_BASE_URL).toBe('http://localhost:9999');
  });

  it('turns the build off with --no-build', () => {
    const args = parseScreenshotArgs(['--no-build', '--out', 'shots'], '/repo');
    expect(args.build).toBe(false);
    expect(args.baseUrl).toBeNull();
  });

  it('throws the usage text without --out', () => {
    expect(() => parseScreenshotArgs(['--routes', 'a'], '/repo')).toThrow(UsageError);
    expect(() => parseScreenshotArgs([], '/repo')).toThrow(USAGE);
    expect(USAGE).toBe(
      'usage: tsx scripts/screenshots.ts --out <dir> [--routes <id,id,...>] [--base-url <url>] [--no-build]',
    );
  });

  it('throws the usage text on an unknown flag or a flag with no value', () => {
    expect(() => parseScreenshotArgs(['--out', 'shots', '--nope'], '/repo')).toThrow(USAGE);
    expect(() => parseScreenshotArgs(['--out'], '/repo')).toThrow(USAGE);
    expect(() => parseScreenshotArgs(['--out', 'shots', '--routes', ','], '/repo')).toThrow(USAGE);
  });
});

describe('screenshotEnv', () => {
  it('sets only the folder when no routes or URL are given', () => {
    const env = screenshotEnv(parseScreenshotArgs(['--out', 'shots'], '/repo'));
    expect(env).toEqual({ SCREENS_OUT: '/repo/shots' });
    expect('SCREENS_ROUTES' in env).toBe(false);
    expect('SCREENS_BASE_URL' in env).toBe(false);
  });

  it('joins the routes with commas', () => {
    const env = screenshotEnv(parseScreenshotArgs(['--out', 'shots', '--routes', 'a, b'], '/repo'));
    expect(env.SCREENS_ROUTES).toBe('a,b');
  });
});

describe('staleParts', () => {
  const SINCE = 1000;
  const old = (name: string): { name: string; mtimeMs: number } => ({ name, mtimeMs: SINCE - 1 });
  const fresh = (name: string): { name: string; mtimeMs: number } => ({ name, mtimeMs: SINCE });

  it('names the parts an earlier capture left of an image this run wrote again', () => {
    // The page was three screens tall and is now two.
    const images = [
      fresh('hello-ready__360x740__light.png'),
      fresh('hello-ready__360x740__light__part02.png'),
      old('hello-ready__360x740__light__part03.png'),
      old('hello-ready__360x740__light__part04.png'),
    ];
    expect(staleParts(images, SINCE)).toEqual([
      'hello-ready__360x740__light__part03.png',
      'hello-ready__360x740__light__part04.png',
    ]);
  });

  it('names every part of a page that now fits one screen', () => {
    const images = [
      old('dev-gallery__1440x900__dark__part02.png'),
      fresh('dev-gallery__1440x900__dark.png'),
    ];
    expect(staleParts(images, SINCE)).toEqual(['dev-gallery__1440x900__dark__part02.png']);
  });

  it('keeps the images of an entry this run did not capture', () => {
    const images = [
      old('dev-gallery__360x740__light.png'),
      old('dev-gallery__360x740__light__part02.png'),
      fresh('hello-ready__360x740__light.png'),
      // The same entry at another viewport, and an entry whose id starts with this one's.
      old('hello-ready__430x932__light__part02.png'),
      old('hello-ready-long__360x740__light__part02.png'),
    ];
    expect(staleParts(images, SINCE)).toEqual([]);
  });

  it('keeps a first image and a file that is not a part', () => {
    const images = [
      fresh('hello-ready__360x740__light.png'),
      old('hello-ready__360x740__dark.png'),
      old('hello-ready__360x740__light__part2.png'),
      old('hello-ready__360x740__light__part02.txt'),
    ];
    expect(staleParts(images, SINCE)).toEqual([]);
  });
});

describe('removeStaleParts', () => {
  it('deletes the stale parts of a folder and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'screens-'));
    try {
      const since = Date.now();
      const before = new Date(since - 60000);
      const after = new Date(since + 1000);
      const write = (name: string, at: Date): void => {
        writeFileSync(join(dir, name), '');
        utimesSync(join(dir, name), at, at);
      };
      write('a__360x740__light.png', after);
      write('a__360x740__light__part02.png', after);
      write('a__360x740__light__part03.png', before);
      write('b__360x740__light.png', before);
      write('b__360x740__light__part02.png', before);
      write('notes.txt', before);
      expect(captureImages(dir).map((image) => image.name)).not.toContain('notes.txt');

      expect(removeStaleParts(dir, since)).toEqual(['a__360x740__light__part03.png']);
      expect(readdirSync(dir).sort()).toEqual([
        'a__360x740__light.png',
        'a__360x740__light__part02.png',
        'b__360x740__light.png',
        'b__360x740__light__part02.png',
        'notes.txt',
      ]);
      // A second pass finds nothing more.
      expect(removeStaleParts(dir, since)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
