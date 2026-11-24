/** The three kinds of row the list spike draws, each a different height (D-100 row 8). */
export type ListSpikeKind = 'text' | 'block' | 'compact';

/** One fixture row of the list spike: no data, only its place in the list and its kind. */
export type ListSpikeItem = { key: string; index: number; kind: ListSpikeKind };

export const LIST_SPIKE_COUNT = 1000;

export const LIST_SPIKE_KINDS: readonly ListSpikeKind[] = ['text', 'block', 'compact'];

/**
 * The row count the `rows` route parameter asks for: a whole number from 1 to 1,000, written in
 * digits. Any other value, or none, gives the spike's 1,000 rows. The design-review capture asks
 * for a few rows, because it captures a list one screen at a time.
 */
export function listSpikeCount(rows: string | null): number {
  if (rows === null || !/^[1-9][0-9]{0,3}$/.test(rows)) {
    return LIST_SPIKE_COUNT;
  }
  const count = Number(rows);
  return count <= LIST_SPIKE_COUNT ? count : LIST_SPIKE_COUNT;
}

/** The spike's fixture rows: item `i` has the key `item-<i>` and the kinds take turns. */
export function listSpikeItems(count: number = LIST_SPIKE_COUNT): readonly ListSpikeItem[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `item-${String(index)}`,
    index,
    kind: kindAt(index),
  }));
}

function kindAt(index: number): ListSpikeKind {
  const kind = LIST_SPIKE_KINDS[index % LIST_SPIKE_KINDS.length];
  // The modulo keeps the index inside the three kinds.
  if (kind === undefined) {
    throw new Error('A list spike kind is missing');
  }
  return kind;
}
