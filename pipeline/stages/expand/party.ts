// Party committees (PIPE-expand step 6, D-318, D-673): one party jurisdiction per county of
// stage 1's county layer and per party, whether or not the county has a government, with its
// approximate district standing in through the county and its committee offices.
import { BDistrictFallbackSchema, BDistrictSchema, BJurisdictionSchema } from '@citizenrun/shared';
import type { BDistrict, BDistrictFallback, BGeometry, BJurisdiction } from '@citizenrun/shared';
import { citedMeta } from '../../templates/output.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { GeometryInputMissing } from '../shared/geometry-rows.ts';
import { appliesTo, entryOffices } from './offices.ts';
import type { DraftOffice, EntryTarget, OfficeContext } from './offices.ts';

export type FallbackRowFn = (key: string, via: readonly BGeometry[]) => Promise<BGeometry>;

const COUNTY_PREFIX = 'tiger:county:';

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** `democratic` → `Democratic`, `working_families` → `Working Families`. */
export function partyLabel(party: string): string {
  return party
    .split('_')
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

export type PartyCommittees = {
  readonly jurisdictions: readonly BJurisdiction[];
  readonly districts: readonly BDistrict[];
  readonly fallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
  readonly drafts: readonly DraftOffice[];
};

/**
 * The party jurisdictions, districts, fallback and geometry rows and offices of the state, for each
 * `tiger:county:` district (by key) and each party of the template, in that order. None when the
 * template's selection is `none`.
 */
export async function partyCommittees(input: {
  readonly template: StateTemplate;
  readonly ctx: OfficeContext;
  readonly districts: readonly BDistrict[];
  readonly geometry: ReadonlyMap<string, BGeometry>;
  readonly countyZone?: ((countyGeoid: string) => string | null) | undefined;
  readonly fallbackRow: FallbackRowFn;
}): Promise<PartyCommittees> {
  const committee = input.template.party_committee;
  const out: {
    jurisdictions: BJurisdiction[];
    districts: BDistrict[];
    fallbacks: BDistrictFallback[];
    geometry: BGeometry[];
    drafts: DraftOffice[];
  } = { jurisdictions: [], districts: [], fallbacks: [], geometry: [], drafts: [] };
  const selection = committee.selection.value;
  if (selection === 'none') {
    return out;
  }
  const selectionMeta = citedMeta(input.ctx.out, 'party_committee.selection', committee.selection);
  const state = input.ctx.state;
  const counties = input.districts
    .filter((d) => d.source_key.startsWith(COUNTY_PREFIX))
    .sort((a, b) => byteOrder(a.source_key, b.source_key));
  for (const county of counties) {
    const geoid = county.source_key.slice(COUNTY_PREFIX.length);
    const viaRow = input.geometry.get(county.source_key);
    if (viaRow === undefined) {
      throw new GeometryInputMissing(county.source_key);
    }
    for (const party of committee.parties) {
      const jurisdictionKey = `party:${state}:${geoid}:${party}`;
      const districtKey = `county_approx:${jurisdictionKey}`;
      const name = `${county.name} ${partyLabel(party)} Party`;
      out.jurisdictions.push(
        BJurisdictionSchema.parse({
          source_key: jurisdictionKey,
          kind: 'party',
          name,
          state,
          census_id: null,
          parent_key: null,
          population: null,
          website: null,
          timezone: input.countyZone?.(geoid) ?? null,
          budget_cents: null,
          budget_year: null,
          census_active: null,
          label_lng: null,
          label_lat: null,
          field_meta: {},
        }),
      );
      const geometry = await input.fallbackRow(districtKey, [viaRow]);
      out.geometry.push(geometry);
      out.districts.push(
        BDistrictSchema.parse({
          source_key: districtKey,
          jurisdiction_key: jurisdictionKey,
          name,
          level: 'special',
          geometry_quality: 'county_approx',
          geom_hash: geometry.geom_hash,
          population: null,
          population_18: null,
          lean: null,
          lean_basis: null,
          field_meta: {},
        }),
      );
      out.fallbacks.push(
        BDistrictFallbackSchema.parse({
          source_key: `${districtKey}|${county.source_key}`,
          district_key: districtKey,
          via_district_key: county.source_key,
        }),
      );
      const target: EntryTarget = {
        jurisdictionKey,
        jurisdictionName: name,
        jurisdictionKind: 'party',
        ownDistrictKey: districtKey,
        exactViaKeys: [county.source_key],
        placeGeoid: null,
        countyGeoid: geoid,
        population: null,
        party: { key: party, selection, meta: selectionMeta },
        statewide: false,
      };
      committee.offices.forEach((entry, j) => {
        const path = `party_committee.offices.${String(j)}`;
        if (!appliesTo(entry, path, name, null)) {
          return;
        }
        const made = entryOffices(input.template, entry, path, target, input.ctx, {
          atLargeOnly: true,
        });
        out.drafts.push(...made.drafts);
      });
    }
  }
  return out;
}
