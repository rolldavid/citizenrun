/** The three kinds of row the list spike draws, each a different height (D-100 row 8). */
export type ListSpikeKind = 'text' | 'block' | 'compact';

/** One fixture row of the list spike: no data, only its place in the list and its kind. */
export type ListSpikeItem = { key: string; index: number; kind: ListSpikeKind };

export const LIST_SPIKE_COUNT = 1000;

export const LIST_SPIKE_KINDS: readonly ListSpikeKind[] = ['text', 'block', 'compact'];

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
