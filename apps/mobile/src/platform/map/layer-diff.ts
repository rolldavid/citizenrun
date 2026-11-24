import type { MapLayerSpec, StyleExpression, StyleValue } from './types';

// PM-map-spike: the declared layer list turned into the library calls that apply it (D-201). Pure, shared by
// both index files.

export type LayerOp =
  | { op: 'add'; spec: MapLayerSpec; before: string }
  | { op: 'remove'; id: string }
  | { op: 'paint'; id: string; key: string; value: StyleValue | null }
  | { op: 'layout'; id: string; key: string; value: StyleValue | null }
  | { op: 'filter'; id: string; filter: StyleExpression | null }
  | { op: 'zoom'; id: string; minzoom: number | null; maxzoom: number | null }
  | { op: 'move'; id: string; before: string };

/** The transition keys of a layer's paint (`fill-opacity-transition`), read from its first appearance only. */
export type PinnedTransitions = ReadonlyMap<string, Readonly<Record<string, StyleValue>>>;

export function isTransitionKey(key: string): boolean {
  return key.endsWith('-transition');
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function replaces(prev: MapLayerSpec, next: MapLayerSpec): boolean {
  return (
    prev.type !== next.type || prev.source !== next.source || prev.sourceLayer !== next.sourceLayer
  );
}

/** Every key whose value changed, appeared or disappeared, next's keys first; transition keys are skipped. */
function changedKeys(
  prev: Readonly<Record<string, StyleValue>>,
  next: Readonly<Record<string, StyleValue>>,
): { key: string; value: StyleValue | null }[] {
  const changes: { key: string; value: StyleValue | null }[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (isTransitionKey(key)) continue;
    if (!Object.hasOwn(prev, key) || !same(prev[key], value)) {
      changes.push({ key, value });
    }
  }
  for (const key of Object.keys(prev)) {
    if (isTransitionKey(key)) continue;
    if (!Object.hasOwn(next, key)) {
      changes.push({ key, value: null });
    }
  }
  return changes;
}

/** The calls that turn the applied list `prev` into `next`: removals, then property changes, then placement. */
export function diffLayers(
  prev: readonly MapLayerSpec[],
  next: readonly MapLayerSpec[],
): LayerOp[] {
  const prevById = new Map(prev.map((spec) => [spec.id, spec]));
  const nextById = new Map(next.map((spec) => [spec.id, spec]));
  const ops: LayerOp[] = [];
  const kept = new Set<string>();

  for (const old of prev) {
    const current = nextById.get(old.id);
    if (current === undefined || replaces(old, current)) {
      ops.push({ op: 'remove', id: old.id });
    } else {
      kept.add(old.id);
    }
  }

  for (const spec of next) {
    const old = prevById.get(spec.id);
    if (old === undefined || !kept.has(spec.id)) continue;
    for (const { key, value } of changedKeys(old.paint, spec.paint)) {
      ops.push({ op: 'paint', id: spec.id, key, value });
    }
    for (const { key, value } of changedKeys(old.layout, spec.layout)) {
      ops.push({ op: 'layout', id: spec.id, key, value });
    }
    if (!same(old.filter, spec.filter)) {
      ops.push({ op: 'filter', id: spec.id, filter: spec.filter });
    }
    if (old.minzoom !== spec.minzoom || old.maxzoom !== spec.maxzoom) {
      ops.push({ op: 'zoom', id: spec.id, minzoom: spec.minzoom, maxzoom: spec.maxzoom });
    }
  }

  for (const spec of next) {
    const old = prevById.get(spec.id);
    if (old === undefined || !kept.has(spec.id)) {
      ops.push({ op: 'add', spec, before: spec.before });
    } else if (old.before !== spec.before) {
      ops.push({ op: 'move', id: spec.id, before: spec.before });
    }
  }

  return ops;
}

/** Phones skip the web-only layers (the hover layers). */
export function forPhones(layers: readonly MapLayerSpec[]): MapLayerSpec[] {
  return layers.filter((spec) => !spec.webOnly);
}

/** Records the transition keys of every layer id seen for the first time; the same object when none is new. */
export function pinTransitions(
  pinned: PinnedTransitions,
  layers: readonly MapLayerSpec[],
): PinnedTransitions {
  const next = new Map(pinned);
  for (const spec of layers) {
    if (next.has(spec.id)) continue;
    next.set(
      spec.id,
      Object.fromEntries(Object.entries(spec.paint).filter(([key]) => isTransitionKey(key))),
    );
  }
  return next.size === pinned.size ? pinned : next;
}

/** The spec with each transition key's value taken from its pinned first value, when one exists. */
export function withPinnedTransitions(spec: MapLayerSpec, pinned: PinnedTransitions): MapLayerSpec {
  const first = pinned.get(spec.id);
  if (first === undefined) return spec;
  const paint: Record<string, StyleValue> = {};
  for (const [key, value] of Object.entries(spec.paint)) {
    paint[key] =
      isTransitionKey(key) && Object.hasOwn(first, key) ? (first[key] as StyleValue) : value;
  }
  return { ...spec, paint };
}

/** The spec as a style-spec layer object; the module's own keys (`before`, `webOnly`) are left out. */
export function toStyleLayer(spec: MapLayerSpec): Record<string, unknown> {
  const layer: Record<string, unknown> = {
    id: spec.id,
    type: spec.type,
    source: spec.source,
    layout: spec.layout,
    paint: spec.paint,
  };
  if (spec.sourceLayer !== null) layer['source-layer'] = spec.sourceLayer;
  if (spec.filter !== null) layer.filter = spec.filter;
  if (spec.minzoom !== null) layer.minzoom = spec.minzoom;
  if (spec.maxzoom !== null) layer.maxzoom = spec.maxzoom;
  return layer;
}
