import { describe, expect, it } from 'vitest';
import {
  bioguidePersonKey,
  boundaryLayerOf,
  censusJurisdictionKey,
  coopJurisdictionKey,
  countyApproxDistrictKey,
  countyUnionDistrictKey,
  districtFallbackKey,
  electionKey,
  filingPersonKey,
  filingTrackKey,
  givenNameAliasKey,
  irs990PersonKey,
  officeholderKey,
  officePowerKey,
  parentFallbackDistrictKey,
  partyJurisdictionKey,
  personAliasKey,
  stateJurisdictionKey,
  tigerDistrictKey,
  wardDistrictKey,
  wikidataPersonKey,
  zctaKey,
  type TigerLayer,
} from './keys.ts';

describe('bundle keys', () => {
  it("builds the grammar's examples", () => {
    expect(tigerDistrictKey('sldl', '25019')).toBe('tiger:sldl:25019');
    expect(countyApproxDistrictKey(censusJurisdictionKey('654321'))).toBe(
      'county_approx:census:654321',
    );
    expect(
      districtFallbackKey(
        countyApproxDistrictKey(coopJurisdictionKey('40211')),
        tigerDistrictKey('county', '37063'),
      ),
    ).toBe('county_approx:coop:40211|tiger:county:37063');
    expect(zctaKey('27601')).toBe('zcta:27601');
    expect(electionKey('wa-seattle-city-council-district-3', '2027-11-02', 'general', null)).toBe(
      'wa-seattle-city-council-district-3|2027-11-02|general|',
    );
    expect(bioguidePersonKey('A000370')).toBe('bioguide:A000370');
    expect(givenNameAliasKey('william', 'bill')).toBe('william|bill');
    expect(stateJurisdictionKey('NC')).toBe('state:NC');
    expect(partyJurisdictionKey('NC', '37063', 'democratic')).toBe('party:NC:37063:democratic');
    expect(wardDistrictKey('3755000', 'ward-1')).toBe('ward:3755000:ward-1');
    expect(countyUnionDistrictKey('NC', 'east')).toBe('county_union:NC:east');
    expect(parentFallbackDistrictKey('census:654321', 'all')).toBe(
      'parent_fallback:census:654321:all',
    );
    expect(officePowerKey('zz-fixture-office', 'property-taxes')).toBe(
      'zz-fixture-office|property-taxes',
    );
    expect(wikidataPersonKey('Q42')).toBe('wikidata:Q42');
    expect(irs990PersonKey('000000001', 'fixture person')).toBe('irs990:000000001:fixture person');
  });

  it('election keys carry the party when there is one', () => {
    expect(electionKey('zz-fixture-office', '2028-03-07', 'primary', 'democratic')).toBe(
      'zz-fixture-office|2028-03-07|primary|democratic',
    );
  });

  it('filing track keys extend the election key', () => {
    const election = electionKey('zz-fixture-office', '2027-11-02', 'general', null);
    expect(filingTrackKey(election, 'nonpartisan')).toBe(`${election}|nonpartisan`);
  });

  it('officeholder keys leave since empty when unknown', () => {
    const person = bioguidePersonKey('Z000001');
    expect(officeholderKey('zz-fixture-office', person, null)).toBe(
      'zz-fixture-office|bioguide:Z000001|',
    );
    expect(officeholderKey('zz-fixture-office', person, '2023-01-03')).toBe(
      'zz-fixture-office|bioguide:Z000001|2023-01-03',
    );
  });

  it('whole keys may hold the separator', () => {
    const filingKey = 'ZZ|zz-fixture-list|2028-03-07|fixture office|Fixture Person';
    const person = filingPersonKey(filingKey);
    expect(person).toBe(`filing:${filingKey}`);
    expect(personAliasKey(person, 'Fix Person')).toBe(`${person}|Fix Person`);
    expect(officeholderKey('zz-fixture-office', person, null)).toBe(`zz-fixture-office|${person}|`);
  });

  it('boundary layers', () => {
    expect(boundaryLayerOf('tiger:place:0820000')).toBe('tiger:place');
    expect(boundaryLayerOf('ward:3755000:ward-1')).toBe('ward:3755000');
    expect(boundaryLayerOf('county_approx:census:654321')).toBe('county_approx:census');
    expect(boundaryLayerOf('county_union:NC:east')).toBe('county_union:NC:east');
    expect(boundaryLayerOf('sldl_union:NH:fixture-floterial')).toBe(
      'sldl_union:NH:fixture-floterial',
    );
  });

  it('refuses bad parts', () => {
    expect(() => givenNameAliasKey('william', 'bi|ll')).toThrow(RangeError);
    expect(() => givenNameAliasKey('', 'bill')).toThrow(RangeError);
    expect(() => givenNameAliasKey('william', 'bi\nll')).toThrow(RangeError);
    expect(() => stateJurisdictionKey('nc')).toThrow(RangeError);
    expect(() => electionKey('zz-fixture-office', '2027-2-1', 'general', null)).toThrow(RangeError);
    expect(() => tigerDistrictKey('zip' as TigerLayer, '27601')).toThrow(RangeError); // a layer from outside the type
    expect(() => tigerDistrictKey('county', '')).toThrow(RangeError);
    expect(() => electionKey('Not A Slug', '2027-11-02', 'general', null)).toThrow(RangeError);
    expect(() => electionKey('zz-fixture-office', '2027-11-02', 'general', 'Democratic')).toThrow(
      RangeError,
    );
    expect(() => filingPersonKey('')).toThrow(RangeError);
    expect(() => personAliasKey('bioguide:Z000001', '')).toThrow(RangeError);
    expect(() => censusJurisdictionKey('12345')).toThrow(RangeError);
    expect(() => zctaKey('2760')).toThrow(RangeError);
    expect(() => officeholderKey('zz-fixture-office', 'bioguide:Z000001', '2023')).toThrow(
      RangeError,
    );
  });
});
