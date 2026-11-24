import { describe, expect, it } from 'vitest';
import { USAGE, UsageError, parseScreenshotArgs, screenshotEnv } from './screenshots.ts';

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
