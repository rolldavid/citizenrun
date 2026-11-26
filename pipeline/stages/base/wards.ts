// Ward and council-district layers of the largest cities (D-320, P8-15): only the layers
// data/boundary_sources.yaml registers, downloaded as GeoJSON, written as exact `ward:` districts
// through the geometry steps 2 to 8.
import { BGeometrySchema } from '@citizenrun/shared';
import type { BoundarySource } from '../../lib/data-files.ts';
import { geomHash, multiPolygonToWkb, toHex } from '../../lib/wkb.ts';
import type { RunContext } from '../../lib/runner.ts';
import { ensureDatasetFile, openDatasetFile } from '../../sources/dataset.ts';
import {
  LayerFieldError,
  displayLayer,
  labelPoint,
  readGeoJsonLayer,
  shiftForAlaska,
} from './geometry.ts';
import type { GeometryRow, LayerFeature, MultiPolygonCoords } from './geometry.ts';
import { outlineFor } from './outline.ts';

export const WARD_DATASET = 'ward-layers';
const GEOJSON = /^(application\/(geo\+)?json|text\/plain)\b/i;
/** A layer larger than this is not a city's ward layer. */
const WARD_MAX_BYTES = 50_000_000;

export type WardDistrict = {
  readonly key: string;
  readonly jurisdictionKey: string;
  /** The label as the layer writes it. */
  readonly name: string;
  readonly geometry: GeometryRow;
  readonly lookupWkbHex: string;
  readonly display: MultiPolygonCoords;
};

export type WardFailure = { readonly layer: string; readonly reason: string };

/** A label in its kebab form: lower-case letters and digits joined by single hyphens. */
export function kebab(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The entries whose place lies in the state (its GEOID begins with the state's FIPS code). */
export function wardEntriesForState(
  entries: readonly BoundarySource[],
  stateFips: string,
): BoundarySource[] {
  return entries.filter((entry) => entry.place_geoid.startsWith(stateFips));
}

/**
 * One layer's districts from its GeoJSON: every feature needs a label in `label_field`, and no two
 * labels may share a kebab form. Throws nothing for a bad layer: it returns the reason instead.
 */
export async function wardLayerDistricts(
  json: object,
  entry: BoundarySource,
  ctx: { jurisdictionKey: string; stateFips: string; mask: MultiPolygonCoords },
): Promise<{ districts: WardDistrict[] } | WardFailure> {
  let read: { features: LayerFeature[]; invalid: string[] };
  try {
    read = await readGeoJsonLayer(json, {
      layer: entry.key,
      fields: { id: entry.label_field, name: entry.label_field },
    });
  } catch (error) {
    if (error instanceof LayerFieldError) {
      return { layer: entry.key, reason: 'a feature has no label' };
    }
    throw error;
  }
  if (read.invalid.length > 0) {
    return { layer: entry.key, reason: 'a feature has no valid polygon' };
  }
  if (read.features.length === 0) {
    return { layer: entry.key, reason: 'the layer has no feature' };
  }
  const byKebab = new Map<string, LayerFeature>();
  for (const feature of read.features) {
    const label = kebab(feature.namelsad);
    if (label === '') {
      return { layer: entry.key, reason: 'a feature has no label' };
    }
    if (byKebab.has(label)) {
      return { layer: entry.key, reason: 'two features share a label' };
    }
    byKebab.set(label, feature);
  }
  const keyed = [...byKebab].map(([label, feature]) => ({
    key: `ward:${entry.place_geoid}:${label}`,
    feature: { ...feature, geoid: `ward:${entry.place_geoid}:${label}` },
  }));
  const clipped = await displayLayer(
    keyed.map(({ feature }) => feature),
    ctx.mask,
  );
  const districts: WardDistrict[] = [];
  for (const { key, feature } of keyed) {
    const display = clipped.get(key) ?? null;
    if (display === null) {
      return { layer: entry.key, reason: 'a feature lies outside the land' };
    }
    const shifted = shiftForAlaska(display, ctx.stateFips);
    const outline = outlineFor(shifted);
    const wkb = multiPolygonToWkb(feature.coords);
    const lookupWkbHex = toHex(wkb);
    districts.push({
      key,
      jurisdictionKey: ctx.jurisdictionKey,
      name: feature.namelsad,
      lookupWkbHex,
      display,
      geometry: BGeometrySchema.parse({
        source_key: key,
        lookup_wkb: lookupWkbHex,
        display_wkb: toHex(multiPolygonToWkb(display)),
        label_point: await labelPoint(shifted),
        outline_svg: outline?.outline_svg ?? null,
        outline_bbox: outline?.outline_bbox ?? null,
        geom_hash: geomHash(wkb),
      }),
    });
  }
  districts.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  return { districts };
}

/**
 * Every registered layer of the state's places: downloaded through the fetcher (`api` class) into
 * `datasets/ward-layers/<retrieved_on>/<key>.geojson`, then read. A layer that fails is logged and
 * counted and leaves the other layers and the state's run alone.
 */
export async function buildWardDistricts(
  ctx: RunContext,
  input: {
    entries: readonly BoundarySource[];
    stateFips: string;
    /** The jurisdiction key of the unit joined to each place GEOID. */
    placeOwners: ReadonlyMap<string, string>;
    mask: MultiPolygonCoords;
  },
): Promise<{ districts: WardDistrict[]; failures: WardFailure[] }> {
  const districts: WardDistrict[] = [];
  const failures: WardFailure[] = [];
  for (const entry of wardEntriesForState(input.entries, input.stateFips)) {
    const fail = (reason: string) => {
      failures.push({ layer: entry.key, reason });
      ctx.log.warn('wards.layer_failed', { layer: entry.key, reason });
    };
    const jurisdictionKey = input.placeOwners.get(entry.place_geoid);
    if (jurisdictionKey === undefined) {
      fail('no loaded unit is joined to the place');
      continue;
    }
    const file = await ensureDatasetFile(ctx, {
      dataset: WARD_DATASET,
      edition: entry.retrieved_on,
      url: entry.url,
      file: `${entry.key}.geojson`,
      class: 'api',
      maxBytes: WARD_MAX_BYTES,
      expectContentType: GEOJSON,
    });
    if (!('key' in file)) {
      fail('needsSeed' in file ? 'needs_seed' : file.failed);
      continue;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of await openDatasetFile(ctx, file.key)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail('the layer is not JSON');
      continue;
    }
    if (typeof json !== 'object' || json === null) {
      fail('the layer is not a GeoJSON object');
      continue;
    }
    const result = await wardLayerDistricts(json, entry, {
      jurisdictionKey,
      stateFips: input.stateFips,
      mask: input.mask,
    });
    if ('reason' in result) {
      fail(result.reason);
      continue;
    }
    districts.push(...result.districts);
  }
  return { districts, failures };
}
