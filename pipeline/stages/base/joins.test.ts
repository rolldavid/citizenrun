// The four joins on each pilot state's fixture (D-311): listing rows, TIGER attribute tables and
// school-finance rows cut from the real files. The expected pairs are written by hand from them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readListing } from '../../sources/census-gus.ts';
import { readSchoolFinance } from '../../sources/school-finance.ts';
import { readDbfBytes } from '../../sources/tiger.ts';
import { readSavedSample } from '../../testing/saved-sample.ts';
import { featureId, joinUnits, refusedPlaceOverrides } from './joins.ts';
import { applyUnitOverrides } from './listing.ts';
import type { JoinLayer, JoinUnit, TigerGeoids } from './joins.ts';
import { unitKind } from './listing.ts';

const JOINS = join(import.meta.dirname, '..', '..', '__fixtures__', 's01', 'joins');
const LAYERS: readonly JoinLayer[] = [
  'county',
  'place',
  'cousub',
  'concity',
  'unsd',
  'elsd',
  'scsd',
];

async function bytes(st: string, file: string): Promise<Buffer> {
  return Buffer.from((await readSavedSample(join(JOINS, st, file))).bytes);
}

async function fixture(st: string) {
  const units: JoinUnit[] = [];
  for await (const row of readListing(Readable.from([await bytes(st, 'listing.xlsx')]))) {
    units.push({ ...row, kind: unitKind(row) });
  }
  const sets: Partial<Record<JoinLayer, Set<string>>> = {};
  for (const layer of LAYERS) {
    const file = `${layer}.dbf`;
    sets[layer] = new Set(
      existsSync(join(JOINS, st, file))
        ? (await readDbfBytes(await bytes(st, file), ['GEOID'])).map((row) => String(row['GEOID']))
        : [],
    );
  }
  const nces = await readSchoolFinance(Readable.from([await bytes(st, 'elsec24t.xlsx')]));
  return { units, tiger: sets as TigerGeoids, nces };
}

async function pairs(st: string): Promise<Record<string, string>> {
  const { units, tiger, nces } = await fixture(st);
  const result = joinUnits(units, tiger, nces);
  return Object.fromEntries([...result.joins].map(([pid6, ref]) => [pid6, featureId(ref)]));
}

/** Each state's expected joins, PID6 to `<layer>:<GEOID>`, read by hand from its fixture files. */
const EXPECTED: Record<string, Record<string, string>> = {
  nc: {
    // Counties: FIPS_STATE 37 and FIPS_COUNTY against the county GEOID.
    '109973': 'county:37003',
    '109978': 'county:37023',
    '109985': 'county:37047',
    '109989': 'county:37059',
    '109995': 'county:37073',
    '109998': 'county:37083',
    '110002': 'county:37095',
    '110009': 'county:37121',
    '110024': 'county:37179',
    '110029': 'county:37193',
    // Municipalities: 37 and FIPS_PLACE against the place GEOID.
    '110034': 'place:3730260',
    '110035': 'place:3763680',
    '110036': 'place:3738200',
    '110037': 'place:3770380',
    '110038': 'place:3703500',
    '110039': 'place:3735360',
    '110040': 'place:3747860',
    '110044': 'place:3744100',
    '110047': 'place:3714100',
    '110050': 'place:3725380',
    // Dependent school systems: PID6 to NCESID to the unified district GEOID. The three
    // community colleges (109977, 109980, 109984) have no NCESID and join nothing.
    '109974': 'unsd:3700210',
    '109976': 'unsd:3700360',
    '109979': 'unsd:3700480',
    '109983': 'unsd:3700780',
    '109986': 'unsd:3704920',
    '109988': 'unsd:3700011',
    '109993': 'unsd:3701320',
  },
  wa: {
    '114606': 'county:53013',
    '114607': 'county:53031',
    '114608': 'county:53045',
    '114610': 'county:53071',
    '136093': 'county:53011',
    '136094': 'county:53019',
    '136095': 'county:53025',
    '136096': 'county:53043',
    '136097': 'county:53059',
    '136098': 'county:53065',
    '114611': 'place:5339510',
    '114612': 'place:5356450',
    '114615': 'place:5340245',
    '114616': 'place:5342800',
    '114617': 'place:5353545',
    '114618': 'place:5327855',
    '114621': 'place:5346895',
    '114622': 'place:5350360',
    '114624': 'place:5305210',
    '114625': 'place:5333805',
    // Independent school districts: PID6 to NCESID to the unified district GEOID.
    '114841': 'unsd:5300450',
    '114842': 'unsd:5307380',
    '114843': 'unsd:5300280',
    '114844': 'unsd:5306630',
    '114845': 'unsd:5307320',
    '114846': 'unsd:5302910',
    '114847': 'unsd:5301200',
    '114849': 'unsd:5300720',
    '114850': 'unsd:5308370',
    '114851': 'unsd:5306000',
  },
  tx: {
    '113467': 'county:48003',
    '113469': 'county:48025',
    '113472': 'county:48039',
    '113476': 'county:48075',
    '113478': 'county:48101',
    '113481': 'county:48133',
    '113482': 'county:48155',
    '113485': 'county:48169',
    '113491': 'county:48199',
    '113498': 'county:48225',
    '113535': 'place:4827300',
    '113536': 'place:4811380',
    '113537': 'place:4880728',
    '113538': 'place:4834532',
    '113539': 'place:4815196',
    '113540': 'place:4876240',
    '113542': 'place:4868456',
    '113543': 'place:4834508',
    '113545': 'place:4842388',
    '113548': 'place:4879672',
    // School units: the five independent districts and Shepherd ISD (DEP tab) are unified districts; the four charter schools (221571, 248837, 248838, 248841) have NCESIDs no school district layer holds.
    '114153': 'unsd:4813200',
    '114154': 'unsd:4819770',
    '114155': 'unsd:4808280',
    '114156': 'unsd:4817040',
    '114157': 'unsd:4846080',
    '211062': 'unsd:4840020',
  },
  la: {
    '105614': 'county:22027',
    '105623': 'county:22039',
    '105663': 'county:22081',
    '105676': 'county:22093',
    '105725': 'county:22127',
    '127793': 'county:22001',
    '127794': 'county:22031',
    '127795': 'county:22041',
    '127796': 'county:22063',
    '127797': 'county:22067',
    '105727': 'place:2264100',
    '105728': 'place:2253370',
    '105729': 'place:2248750',
    '105731': 'place:2213260',
    '105732': 'place:2206925',
    '105734': 'place:2257590',
    '105737': 'place:2237445',
    '105740': 'place:2280815',
    '105741': 'place:2238775',
    '105743': 'place:2245040',
    // Parish school districts; the Recovery School District (228229) has an NCESID no layer holds.
    '105811': 'unsd:2200030',
    '105812': 'unsd:2200120',
    '105813': 'unsd:2200180',
    '105814': 'unsd:2200270',
    '105815': 'unsd:2200330',
  },
  va: {
    '114501': 'county:51001',
    '114507': 'county:51021',
    '114509': 'county:51031',
    '114514': 'county:51059',
    '114524': 'county:51125',
    '114530': 'county:51177',
    '114537': 'county:51195',
    '136002': 'county:51005',
    '136003': 'county:51025',
    '136004': 'county:51029',
    '114538': 'place:5108120',
    '114539': 'place:5159336',
    '114540': 'place:5170576',
    '114541': 'place:5161896',
    '114542': 'place:5136008',
    '114544': 'place:5140536',
    '114545': 'place:5167208',
    '114547': 'place:5151448',
    '114548': 'place:5143176',
    '114549': 'place:5124752',
    // Dependent school systems; the medical school on the School District tab (140687) has no NCESID.
    '114503': 'unsd:5100180',
    '114504': 'unsd:5100240',
    '114505': 'unsd:5100300',
    '114506': 'unsd:5100330',
    '114508': 'unsd:5100420',
  },
};

describe('the four joins match on each pilot state fixture', () => {
  for (const st of Object.keys(EXPECTED)) {
    it(st.toUpperCase(), async () => {
      expect(await pairs(st)).toEqual(EXPECTED[st]);
    });
  }

  it('never joins a county through its placeholder FIPS_PLACE, nor a unit by name', async () => {
    const { units, tiger, nces } = await fixture('nc');
    const county = units.find((unit) => unit.kind === 'county');
    if (county === undefined) throw new Error('no county');
    // A place GEOID made from the county row's placeholder FIPS_PLACE (99 and the county code).
    const placeholder = new Set([...tiger.place, `${county.fips_state}${county.fips_place ?? ''}`]);
    const result = joinUnits(
      [{ ...county, fips_county: null }],
      { ...tiger, place: placeholder },
      nces,
    );
    expect(result.joins.size).toBe(0);
    expect(result.counts.county).toEqual({ units: 1, matched: 0 });
  });

  it('a municipality not in PLACE joins CONCITY, and the smaller PID6 owns a shared feature', () => {
    const unit = (pid6: string): JoinUnit => ({
      pid6,
      tab: 'General Purpose',
      kind: 'city',
      fips_state: '99',
      fips_county: '001',
      fips_place: '52004',
    });
    const empty = new Set<string>();
    const tiger: TigerGeoids = {
      county: empty,
      place: empty,
      cousub: empty,
      concity: new Set(['9952004']),
      unsd: empty,
      elsd: empty,
      scsd: empty,
    };
    const result = joinUnits([unit('990002'), unit('990001')], tiger, new Map());
    expect(result.joins.get('990001')).toEqual({ layer: 'concity', geoid: '9952004' });
    expect(result.owners.get('concity:9952004')).toBe('990001');
    expect(result.shared).toEqual(['990002']);
  });

  it('a corrected place code joins, and one TIGER does not have is refused', () => {
    const empty = new Set<string>();
    const tiger: TigerGeoids = {
      county: empty,
      place: new Set(['9971550']),
      cousub: empty,
      concity: empty,
      unsd: empty,
      elsd: empty,
      scsd: empty,
    };
    const city = (pid6: string, place: string): JoinUnit => ({
      pid6,
      tab: 'General Purpose',
      kind: 'city',
      fips_state: '99',
      fips_county: '003',
      fips_place: place,
    });
    const units = [city('990001', '71550'), city('990002', '17000')];
    const result = joinUnits(units, tiger, new Map());
    const overrides = [
      { pid6: '990001', fips_place: '71550' },
      { pid6: '990002', fips_place: '17000' },
      { pid6: '990003', fips_place: '12345' },
      { pid6: '990004' },
    ];
    expect(result.joins.get('990001')).toEqual({ layer: 'place', geoid: '9971550' });
    expect(refusedPlaceOverrides(units, overrides, result)).toEqual(['990002']);
  });

  it('an override fips_place replaces the listing code', () => {
    const row = {
      pid6: '990001',
      unit_name: 'CITY OF EXAMPLE',
      web_address: null,
      fips_place: '17000',
    } as unknown as Parameters<typeof applyUnitOverrides>[0][number];
    const [out] = applyUnitOverrides([row], [{ pid6: '990001', fips_place: '71550', reason: 'r' }]);
    expect(out?.fips_place).toBe('71550');
    expect(out?.unit_name).toBe('CITY OF EXAMPLE');
  });
});
