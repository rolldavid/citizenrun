import { describe, expect, it } from 'vitest';
import { formatTable } from './table.ts';

describe('formatTable', () => {
  it('pads columns to the widest cell', () => {
    expect(formatTable(['a', 'bb'], [['ccc', 'd']])).toBe('a    bb\n---  --\nccc  d');
  });

  it('writes no trailing spaces', () => {
    const output = formatTable(
      ['name', 'status', 'note'],
      [
        ['one', 'ok', ''],
        ['a much longer name', '', 'x'],
        ['two', 'failed', 'a longer note'],
      ],
    );
    const lines = output.split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.endsWith(' ')).toBe(false);
    }
    expect(lines[1]).toBe('------------------  ------  -------------');
    expect(lines[3]).toBe('a much longer name          x');
  });

  it('writes only the header and the dashed line when there are no rows', () => {
    expect(formatTable(['id', 'value'], [])).toBe('id  value\n--  -----');
  });
});
