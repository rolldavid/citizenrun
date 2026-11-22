import { describe, expect, it } from 'vitest';
import { formatText } from './format.ts';

describe('formatText', () => {
  it("formats JSON as the repository's Prettier does", async () => {
    expect(await formatText('x.json', '{"a":[1,2]}')).toBe('{ "a": [1, 2] }\n');
  });

  it('formats TypeScript with the repository settings', async () => {
    expect(await formatText('x.ts', 'export const a = {"b": "c"}')).toBe(
      "export const a = { b: 'c' };\n",
    );
  });
});
