import { describe, expect, it } from 'vitest';
import { UsageError, parseArgs } from './args.ts';

describe('parseArgs', () => {
  it('--state NC,WA gives the two codes', () => {
    const args = parseArgs(['base', '--state', 'NC,WA']);
    expect(args.command).toEqual(['base']);
    expect(args.states).toEqual(['NC', 'WA']);
    expect(args.dryRun).toBe(false);
  });

  it('--state all', () => {
    expect(parseArgs(['base', '--state', 'all']).states).toBe('all');
  });

  it('--state US', () => {
    expect(parseArgs(['base', '--state', 'US']).states).toEqual(['US']);
  });

  it('--states NC for reachability', () => {
    expect(parseArgs(['reachability', '--states', 'NC']).states).toEqual(['NC']);
  });

  it('no state flag gives null', () => {
    expect(parseArgs(['housekeeping']).states).toBeNull();
  });

  it('--state nc throws', () => {
    expect(() => parseArgs(['base', '--state', 'nc'])).toThrow(UsageError);
  });

  it('--state ZZ throws', () => {
    expect(() => parseArgs(['base', '--state', 'ZZ'])).toThrow(UsageError);
    expect(() => parseArgs(['base', '--state', 'PR'])).toThrow(UsageError);
  });

  it('a duplicate code throws', () => {
    expect(() => parseArgs(['base', '--state', 'NC,WA,NC'])).toThrow(UsageError);
  });

  it('datasets seed takes its four flags', () => {
    const args = parseArgs([
      'datasets',
      'seed',
      '--dataset',
      'census-gus',
      '--edition',
      '2026',
      '--file',
      '/x',
      '--source-url',
      'https://a.gov/b',
    ]);
    expect(args.command).toEqual(['datasets', 'seed']);
    expect([...args.flags]).toEqual([
      ['dataset', 'census-gus'],
      ['edition', '2026'],
      ['file', '/x'],
      ['source-url', 'https://a.gov/b'],
    ]);
  });

  it('--dry-run is boolean', () => {
    const args = parseArgs(['housekeeping', '--dry-run']);
    expect(args.dryRun).toBe(true);
    expect(args.flags.size).toBe(0);
    expect(() => parseArgs(['housekeeping', '--dry-run=yes'])).toThrow(UsageError);
  });

  it('--edition=2026 form', () => {
    expect(parseArgs(['datasets', 'seed', '--edition=2026']).flags.get('edition')).toBe('2026');
  });

  it('refuses a flag without a value, a stray word and a repeated flag', () => {
    expect(() => parseArgs(['datasets', 'seed', '--edition'])).toThrow(UsageError);
    expect(() => parseArgs(['base', '--state', 'NC', 'extra'])).toThrow(UsageError);
    expect(() => parseArgs(['x', '--file', 'a', '--file', 'b'])).toThrow(UsageError);
    expect(() => parseArgs(['base', '--state', 'NC', '--states', 'WA'])).toThrow(UsageError);
    expect(() => parseArgs(['Base'])).toThrow(UsageError);
  });

  it('no arguments give an empty command', () => {
    expect(parseArgs([]).command).toEqual([]);
  });
});
