import { describe, expect, it } from 'vitest';

import {
  diffLayers,
  forPhones,
  isTransitionKey,
  pinTransitions,
  toStyleLayer,
  withPinnedTransitions,
} from './layer-diff';
import type { PinnedTransitions } from './layer-diff';
import type { MapLayerSpec } from './types';

function layer(id: string, overrides: Partial<MapLayerSpec> = {}): MapLayerSpec {
  return {
    id,
    type: 'fill',
    source: 's',
    sourceLayer: 'l',
    before: 'anchor-fill',
    minzoom: null,
    maxzoom: null,
    filter: null,
    layout: {},
    paint: {},
    webOnly: false,
    ...overrides,
  };
}

const a = layer('a');
const b = layer('b');
const c = layer('c');

describe('diffLayers', () => {
  it('an added layer is added before its anchor', () => {
    expect(diffLayers([a], [a, b])).toEqual([{ op: 'add', spec: b, before: 'anchor-fill' }]);
  });

  it('a layer added in the middle is inserted before its anchor', () => {
    expect(diffLayers([a, c], [a, b, c])).toEqual([{ op: 'add', spec: b, before: 'anchor-fill' }]);
  });

  it('a removed layer is removed', () => {
    expect(diffLayers([a, b], [a])).toEqual([{ op: 'remove', id: 'b' }]);
  });

  it('a moved layer is moved', () => {
    expect(diffLayers([a, b], [a, layer('b', { before: 'anchor-line' })])).toEqual([
      { op: 'move', id: 'b', before: 'anchor-line' },
    ]);
  });

  it('a changed paint value gives one paint op', () => {
    expect(
      diffLayers(
        [layer('a', { paint: { 'fill-opacity': 1 } })],
        [layer('a', { paint: { 'fill-opacity': 0.4 } })],
      ),
    ).toEqual([{ op: 'paint', id: 'a', key: 'fill-opacity', value: 0.4 }]);
  });

  it('a changed transition key gives nothing', () => {
    expect(
      diffLayers(
        [layer('a', { paint: { 'fill-opacity-transition': { duration: 300, delay: 0 } } })],
        [layer('a', { paint: { 'fill-opacity-transition': { duration: 0, delay: 0 } } })],
      ),
    ).toEqual([]);
  });

  it('a changed source gives a remove and an add', () => {
    const moved = layer('a', { source: 't' });
    expect(diffLayers([a], [moved])).toEqual([
      { op: 'remove', id: 'a' },
      { op: 'add', spec: moved, before: 'anchor-fill' },
    ]);
  });

  it('a changed type or source layer also replaces the layer', () => {
    const line = layer('a', { type: 'line' });
    expect(diffLayers([a], [line])).toEqual([
      { op: 'remove', id: 'a' },
      { op: 'add', spec: line, before: 'anchor-fill' },
    ]);
    const other = layer('a', { sourceLayer: 'm' });
    expect(diffLayers([a], [other])).toEqual([
      { op: 'remove', id: 'a' },
      { op: 'add', spec: other, before: 'anchor-fill' },
    ]);
  });

  it('layout, filter and zoom changes', () => {
    expect(
      diffLayers(
        [layer('a', { layout: { visibility: 'visible' } })],
        [layer('a', { layout: { visibility: 'none' } })],
      ),
    ).toEqual([{ op: 'layout', id: 'a', key: 'visibility', value: 'none' }]);

    const filter = ['==', ['get', 'level'], 'state'];
    expect(diffLayers([a], [layer('a', { filter })])).toEqual([{ op: 'filter', id: 'a', filter }]);
    expect(diffLayers([layer('a', { filter })], [a])).toEqual([
      { op: 'filter', id: 'a', filter: null },
    ]);

    expect(diffLayers([a], [layer('a', { minzoom: 3 })])).toEqual([
      { op: 'zoom', id: 'a', minzoom: 3, maxzoom: null },
    ]);
  });

  it('a paint key that disappears is unset', () => {
    expect(diffLayers([layer('a', { paint: { 'fill-color': '#000000' } })], [a])).toEqual([
      { op: 'paint', id: 'a', key: 'fill-color', value: null },
    ]);
  });

  it('equal values written anew give nothing', () => {
    const before = layer('a', {
      paint: { 'fill-color': ['get', 'color'] },
      filter: ['==', 1, 1],
    });
    const after = layer('a', {
      paint: { 'fill-color': ['get', 'color'] },
      filter: ['==', 1, 1],
    });
    expect(diffLayers([before], [after])).toEqual([]);
  });

  it('removes come before property changes and placement', () => {
    const ops = diffLayers(
      [layer('a', { paint: { 'fill-opacity': 1 } }), b],
      [layer('a', { paint: { 'fill-opacity': 0.5 } }), c],
    );
    expect(ops).toEqual([
      { op: 'remove', id: 'b' },
      { op: 'paint', id: 'a', key: 'fill-opacity', value: 0.5 },
      { op: 'add', spec: c, before: 'anchor-fill' },
    ]);
  });

  it('a first render adds every layer in list order', () => {
    const line = layer('d', { before: 'anchor-line' });
    expect(diffLayers([], [a, line, b])).toEqual([
      { op: 'add', spec: a, before: 'anchor-fill' },
      { op: 'add', spec: line, before: 'anchor-line' },
      { op: 'add', spec: b, before: 'anchor-fill' },
    ]);
  });
});

describe('the phone helpers', () => {
  it('phones skip web-only layers', () => {
    expect(forPhones([a, { ...b, webOnly: true }])).toEqual([a]);
  });

  it('transitions are pinned to their first values', () => {
    const first = layer('a', {
      paint: { 'fill-opacity': 1, 'fill-opacity-transition': { duration: 300, delay: 0 } },
    });
    const empty: PinnedTransitions = new Map();
    const pinned = pinTransitions(empty, [first]);
    expect(pinned.get('a')).toEqual({ 'fill-opacity-transition': { duration: 300, delay: 0 } });

    const later = layer('a', {
      paint: { 'fill-opacity': 0.4, 'fill-opacity-transition': { duration: 0, delay: 0 } },
    });
    expect(withPinnedTransitions(later, pinned).paint).toEqual({
      'fill-opacity': 0.4,
      'fill-opacity-transition': { duration: 300, delay: 0 },
    });

    expect(pinTransitions(pinned, [first])).toBe(pinned);
    expect(pinTransitions(pinned, [later])).toBe(pinned);
  });

  it('a layer seen for the first time later keeps its own first values', () => {
    const pinned = pinTransitions(new Map(), [a]);
    const added = layer('b', {
      paint: { 'fill-opacity-transition': { duration: 120, delay: 30 } },
    });
    const next = pinTransitions(pinned, [a, added]);
    expect(next).not.toBe(pinned);
    expect(next.get('b')).toEqual({ 'fill-opacity-transition': { duration: 120, delay: 30 } });
    expect(withPinnedTransitions(added, next)).toEqual(added);
  });

  it('a spec with no pinned record is returned unchanged', () => {
    expect(withPinnedTransitions(a, new Map())).toBe(a);
  });
});

describe('isTransitionKey', () => {
  it('names only the transition keys', () => {
    expect(isTransitionKey('fill-opacity-transition')).toBe(true);
    expect(isTransitionKey('fill-opacity')).toBe(false);
    expect(isTransitionKey('transition')).toBe(false);
  });
});

describe('toStyleLayer', () => {
  it("the style layer drops the module's own keys", () => {
    const styled = toStyleLayer(a);
    expect(styled).toEqual({
      id: 'a',
      type: 'fill',
      source: 's',
      'source-layer': 'l',
      layout: {},
      paint: {},
    });
    expect(styled).not.toHaveProperty('before');
    expect(styled).not.toHaveProperty('webOnly');
    expect(styled).not.toHaveProperty('sourceLayer');

    const geojson = toStyleLayer(layer('g', { sourceLayer: null }));
    expect(geojson).not.toHaveProperty('source-layer');
    expect(geojson).not.toHaveProperty('filter');
    expect(geojson).not.toHaveProperty('minzoom');
    expect(geojson).not.toHaveProperty('maxzoom');
  });

  it('a filter and a zoom range are kept when set', () => {
    const filter = ['has', 'name'];
    expect(toStyleLayer(layer('z', { filter, minzoom: 4, maxzoom: 12 }))).toMatchObject({
      filter,
      minzoom: 4,
      maxzoom: 12,
    });
  });
});
