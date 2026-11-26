import type { StateTemplate } from './schema.ts';

/** A cited value's proof: the page it comes from, the exact text and the section it cites. */
export type CitedNode = {
  readonly source_url: string;
  readonly quote: string;
  readonly citation: string;
};

function isCitedNode(value: Record<string, unknown>): value is Record<string, unknown> & CitedNode {
  return (
    typeof value['source_url'] === 'string' &&
    typeof value['quote'] === 'string' &&
    typeof value['citation'] === 'string'
  );
}

function walk(
  value: unknown,
  path: readonly string[],
  out: { path: string; node: CitedNode }[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, [...path, String(index)], out);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const record = value as Record<string, unknown>; // a parsed template object: string keys only
  if (isCitedNode(record)) {
    out.push({
      path: path.join('.'),
      node: { source_url: record.source_url, quote: record.quote, citation: record.citation },
    });
  }
  for (const [key, child] of Object.entries(record)) {
    walk(child, [...path, key], out);
  }
}

/**
 * Every object of the parsed template that has `source_url`, `quote` and `citation`, depth first
 * in key order, with its YAML path. `calendar_pages` items carry no quote and are not cited nodes.
 */
export function citedNodes(template: StateTemplate): readonly { path: string; node: CitedNode }[] {
  const out: { path: string; node: CitedNode }[] = [];
  walk(template, [], out);
  return out;
}
