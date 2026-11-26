import type { z } from 'zod';
import {
  ElectionKindSchema,
  IsoDateSchema,
  PartySchema,
  SlugSchema,
  StateCodeSchema,
  TrackSchema,
} from './common.ts';

type ElectionKindValue = z.infer<typeof ElectionKindSchema>;
type TrackValue = z.infer<typeof TrackSchema>;

export const KEY_SEPARATOR = '|';
export const TIGER_LAYERS = [
  'state',
  'county',
  'place',
  'cousub',
  'cd',
  'sldu',
  'sldl',
  'unsd',
  'elsd',
  'scsd',
  'concity',
] as const;
export type TigerLayer = (typeof TIGER_LAYERS)[number];

const UNION_LAYER = /^(county|sldl)_union:/;
const LAST_SEGMENT = /:[^:]*$/;

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** A part that is itself a whole key: non-empty and free of control characters. */
function wholeKey(name: string, value: string): string {
  if (value === '' || hasControl(value)) {
    throw new RangeError(`${name} must be a non-empty key without control characters`);
  }
  return value;
}

/** An atomic part: non-empty, without the separator and without control characters. */
function part(name: string, value: string): string {
  if (value === '' || value.includes(KEY_SEPARATOR) || hasControl(value)) {
    throw new RangeError(`${name} must be non-empty, without '|' or control characters`);
  }
  return value;
}

function matching(name: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new RangeError(`${name} has the wrong form`);
  }
  return value;
}

function stateCode(value: string): string {
  if (!StateCodeSchema.safeParse(value).success) {
    throw new RangeError('state must be two capital letters');
  }
  return value;
}

function slug(value: string): string {
  if (!SlugSchema.safeParse(value).success) {
    throw new RangeError('officeSlug is not a slug');
  }
  return value;
}

function date(name: string, value: string): string {
  if (!IsoDateSchema.safeParse(value).success) {
    throw new RangeError(`${name} must be YYYY-MM-DD`);
  }
  return value;
}

function join(...parts: string[]): string {
  return parts.join(KEY_SEPARATOR);
}

/** state:NC */
export function stateJurisdictionKey(state: string): string {
  return `state:${stateCode(state)}`;
}

/** census:123456 (six digits) */
export function censusJurisdictionKey(pid6: string): string {
  return `census:${matching('pid6', pid6, /^\d{6}$/)}`;
}

/** coop:40211 (digits) */
export function coopJurisdictionKey(eiaUtilityNumber: string): string {
  return `coop:${matching('eiaUtilityNumber', eiaUtilityNumber, /^\d+$/)}`;
}

/** party:NC:37063:democratic */
export function partyJurisdictionKey(state: string, countyGeoid: string, partyKey: string): string {
  if (!PartySchema.safeParse(partyKey).success) {
    throw new RangeError('partyKey is not a party key');
  }
  return `party:${stateCode(state)}:${part('countyGeoid', countyGeoid)}:${partyKey}`;
}

/** tiger:sldl:25019 */
export function tigerDistrictKey(layer: TigerLayer, geoid: string): string {
  if (!(TIGER_LAYERS as readonly string[]).includes(layer)) {
    throw new RangeError('layer is not a TIGER layer');
  }
  return `tiger:${layer}:${part('geoid', geoid)}`;
}

/** ward:3755000:ward-1 */
export function wardDistrictKey(placeGeoid: string, kebabLabel: string): string {
  return `ward:${part('placeGeoid', placeGeoid)}:${part('kebabLabel', kebabLabel)}`;
}

/** county_union:NC:<set id> */
export function countyUnionDistrictKey(state: string, setId: string): string {
  return `county_union:${stateCode(state)}:${part('setId', setId)}`;
}

/** county_approx:census:654321 */
export function countyApproxDistrictKey(jurisdictionKey: string): string {
  return `county_approx:${part('jurisdictionKey', jurisdictionKey)}`;
}

/** parent_fallback:<jurisdiction key>:<kebab seat label or all> */
export function parentFallbackDistrictKey(
  jurisdictionKey: string,
  kebabSeatLabelOrAll: string,
): string {
  return `parent_fallback:${part('jurisdictionKey', jurisdictionKey)}:${part('kebabSeatLabelOrAll', kebabSeatLabelOrAll)}`;
}

/** <district key>|<via key> */
export function districtFallbackKey(districtKey: string, viaDistrictKey: string): string {
  return join(part('districtKey', districtKey), part('viaDistrictKey', viaDistrictKey));
}

/** zcta:27601 (five digits) */
export function zctaKey(zcta5: string): string {
  return `zcta:${matching('zcta5', zcta5, /^\d{5}$/)}`;
}

/** <office slug>|<power id> */
export function officePowerKey(officeSlug: string, powerId: string): string {
  return join(slug(officeSlug), part('powerId', powerId));
}

/** wa-seattle-city-council-district-3|2027-11-02|general| (party empty when null) */
export function electionKey(
  officeSlug: string,
  electionDate: string,
  kind: ElectionKindValue,
  party: string | null,
): string {
  if (!ElectionKindSchema.safeParse(kind).success) {
    throw new RangeError('kind is not an election kind');
  }
  if (party !== null && !PartySchema.safeParse(party).success) {
    throw new RangeError('party is not a party key');
  }
  return join(slug(officeSlug), date('electionDate', electionDate), kind, party ?? '');
}

/** <election key>|<track> */
export function filingTrackKey(electionKey: string, track: TrackValue): string {
  if (!TrackSchema.safeParse(track).success) {
    throw new RangeError('track is not a filing track');
  }
  return join(wholeKey('electionKey', electionKey), track);
}

/** <office slug>|<person key>|<since YYYY-MM-DD> (since empty when null) */
export function officeholderKey(
  officeSlug: string,
  personKey: string,
  since: string | null,
): string {
  return join(
    slug(officeSlug),
    wholeKey('personKey', personKey),
    since === null ? '' : date('since', since),
  );
}

/** <person key>|<alias> */
export function personAliasKey(personKey: string, alias: string): string {
  return join(wholeKey('personKey', personKey), part('alias', alias));
}

/** william|bill */
export function givenNameAliasKey(canonical: string, alias: string): string {
  return join(part('canonical', canonical), part('alias', alias));
}

/** bioguide:A000370 */
export function bioguidePersonKey(id: string): string {
  return `bioguide:${part('id', id)}`;
}

/** openstates:<id> */
export function openstatesPersonKey(id: string): string {
  return `openstates:${part('id', id)}`;
}

/** wikidata:Q<digits> */
export function wikidataPersonKey(qid: string): string {
  return `wikidata:${matching('qid', qid, /^Q\d+$/)}`;
}

/** irs990:<nine digits>:<name key> */
export function irs990PersonKey(ein: string, nameKey: string): string {
  return `irs990:${matching('ein', ein, /^\d{9}$/)}:${part('nameKey', nameKey)}`;
}

/** roster:<office slug>:<name key> */
export function rosterPersonKey(officeSlug: string, nameKey: string): string {
  return `roster:${slug(officeSlug)}:${part('nameKey', nameKey)}`;
}

/** filing:<filing key>, made only by the worker */
export function filingPersonKey(filingKey: string): string {
  return `filing:${wholeKey('filingKey', filingKey)}`;
}

/** The boundary layer of a district key: everything before its last colon (tiger:place, ward:<place GEOID>); a county_union: or sldl_union: key is a layer of its own and is returned whole (L-point-lookup). */
export function boundaryLayerOf(districtKey: string): string {
  if (UNION_LAYER.test(districtKey)) {
    return districtKey;
  }
  return districtKey.replace(LAST_SEGMENT, '');
}
