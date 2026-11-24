import { describe, expect, it } from 'vitest';

import { LIST_SPIKE_COUNT, listSpikeCount, listSpikeItems } from './list-spike-items';

describe('listSpikeItems', () => {
  it('there are 1,000 rows', () => {
    expect(LIST_SPIKE_COUNT).toBe(1000);
    expect(listSpikeItems()).toHaveLength(1000);
  });

  it('keys are unique and stable', () => {
    const items = listSpikeItems();
    expect(new Set(items.map((item) => item.key)).size).toBe(1000);
    expect(items[0]).toEqual({ key: 'item-0', index: 0, kind: 'text' });
    expect(items[999]?.key).toBe('item-999');
    expect(items[999]?.index).toBe(999);
    expect(listSpikeItems().map((item) => item.key)).toEqual(items.map((item) => item.key));
  });

  it('the three kinds take turns', () => {
    const items = listSpikeItems();
    expect(items.slice(0, 4).map((item) => item.kind)).toEqual([
      'text',
      'block',
      'compact',
      'text',
    ]);
    const counts = { text: 0, block: 0, compact: 0 };
    for (const item of items) counts[item.kind] += 1;
    expect(counts).toEqual({ text: 334, block: 333, compact: 333 });
  });

  it('a shorter list for other uses', () => {
    const items = listSpikeItems(4);
    expect(items).toHaveLength(4);
    expect(items[3]).toEqual({ key: 'item-3', index: 3, kind: 'text' });
  });

  it('the rows parameter sets a shorter list', () => {
    expect(listSpikeCount(null)).toBe(1000);
    expect(listSpikeCount('12')).toBe(12);
    expect(listSpikeCount('1')).toBe(1);
    expect(listSpikeCount('1000')).toBe(1000);
    for (const rows of ['', '0', '-3', '012', '1.5', '1e2', ' 12', '12abc', '1001', '99999']) {
      expect(listSpikeCount(rows)).toBe(1000);
    }
  });
});
