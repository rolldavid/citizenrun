import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DataFileError, formatPath, parseYaml, parseYamlWith } from './yaml.ts';

function problemsOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof DataFileError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('expected a DataFileError');
}

describe('parseYaml', () => {
  it('refuses a duplicate key, naming the file and the line', () => {
    const problems = problemsOf(() =>
      parseYaml('a: 1\nb: secret-value\nb: 3\n', 'data/fixture.yaml'),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toBe('data/fixture.yaml: line 3: DUPLICATE_KEY');
    expect(problems.join('\n')).not.toContain('secret-value');
  });

  it('refuses a custom tag', () => {
    const problems = problemsOf(() => parseYaml('a: !shout hidden-value\n', 'data/fixture.yaml'));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/^data\/fixture\.yaml: line 1: /);
    expect(problems.join('\n')).not.toContain('hidden-value');
  });

  it('keeps a calendar date a string', () => {
    expect(parseYaml('from: 2027-01-13\n', 'data/fixture.yaml')).toEqual({ from: '2027-01-13' });
  });
});

describe('parseYamlWith', () => {
  const Schema = z.array(z.strictObject({ id: z.string(), size: z.int().max(10) }));

  it('reports a schema problem with its path and line and not the value', () => {
    const text = '- id: first\n  size: 1\n- id: second\n  size: 9999\n';
    const problems = problemsOf(() => parseYamlWith(text, 'data/fixture.yaml', Schema));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^data\/fixture\.yaml: \[1\]\.size \(line 4\): /);
    expect(problems[0]).not.toContain('9999');
  });

  it('reports an unknown key at the key itself', () => {
    const text = '- id: first\n  size: 1\n  extra: private-text\n';
    const problems = problemsOf(() => parseYamlWith(text, 'data/fixture.yaml', Schema));
    expect(problems).toEqual([
      expect.stringMatching(/^data\/fixture\.yaml: \[0\]\.extra \(line 3\): /),
    ]);
    expect(problems[0]).not.toContain('private-text');
  });

  it('returns the parsed value when it passes', () => {
    expect(parseYamlWith('- id: a\n  size: 2\n', 'data/fixture.yaml', Schema)).toEqual([
      { id: 'a', size: 2 },
    ]);
  });
});

describe('formatPath', () => {
  it('writes a.b[2].c', () => {
    expect(formatPath(['a', 'b', 2, 'c'])).toBe('a.b[2].c');
    expect(formatPath([0, 'notes'])).toBe('[0].notes');
    expect(formatPath([])).toBe('(root)');
  });
});
