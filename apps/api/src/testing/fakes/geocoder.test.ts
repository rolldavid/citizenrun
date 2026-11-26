import { describe, expect, it } from 'vitest';
import { fakeAddressSuggestions, fakeCensusGeocoder } from './geocoder.ts';
import { createFakeOutbound } from './outbound.ts';

const CENSUS = 'geocoding.geo.census.gov';
const GEOAPIFY = 'api.geoapify.com';

function censusPath(address: string): string {
  return `/geocoder/geographies/onelineaddress?${new URLSearchParams({ address, format: 'json' }).toString()}`;
}

function suggestPath(text: string): string {
  return `/v1/geocode/autocomplete?${new URLSearchParams({ text, format: 'json' }).toString()}`;
}

describe('fakeCensusGeocoder', () => {
  it('answers from the table', async () => {
    const outbound = createFakeOutbound();
    fakeCensusGeocoder(outbound, {
      '1 Fixture Way': {
        kind: 'match',
        lat: 30.004321,
        lng: -39.995678,
        geographies: { States: [{ GEOID: '99' }] },
      },
      '2 Fixture Way': '5xx',
      '3 Fixture Way': '4xx',
      '4 Fixture Way': 'garbled',
    });
    const match = await outbound.fetch(CENSUS, censusPath('1 Fixture Way'));
    expect(match.status).toBe(200);
    expect(await match.json()).toEqual({
      result: {
        input: { address: { address: '1 Fixture Way' } },
        addressMatches: [
          {
            matchedAddress: '1 Fixture Way',
            coordinates: { x: -39.995678, y: 30.004321 },
            geographies: { States: [{ GEOID: '99' }] },
          },
        ],
      },
    });
    const failed = await outbound.fetch(CENSUS, censusPath('2 Fixture Way'));
    expect(failed.status).toBe(503);
    expect(await failed.text()).toContain('2 Fixture Way');
    expect((await outbound.fetch(CENSUS, censusPath('3 Fixture Way'))).status).toBe(400);
    const garbled = await outbound.fetch(CENSUS, censusPath('4 Fixture Way'));
    expect(garbled.status).toBe(200);
    expect(await garbled.json()).toEqual({ unexpected: true });
  });

  it('an unknown address is no match', async () => {
    const outbound = createFakeOutbound();
    fakeCensusGeocoder(outbound, {});
    const response = await outbound.fetch(CENSUS, censusPath('9 Unknown Fixture Rd'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { input: { address: { address: '9 Unknown Fixture Rd' } }, addressMatches: [] },
    });
    // A key inherited from Object.prototype is not an entry of the table.
    const inherited = await outbound.fetch(CENSUS, censusPath('toString'));
    expect(await inherited.json()).toMatchObject({ result: { addressMatches: [] } });
  });

  it('a timeout throws a TimeoutError', async () => {
    const outbound = createFakeOutbound();
    fakeCensusGeocoder(outbound, { '5 Fixture Way': 'timeout' });
    fakeAddressSuggestions(outbound, { '5 Fix': 'timeout' });
    for (const call of [
      outbound.fetch(CENSUS, censusPath('5 Fixture Way')),
      outbound.fetch(GEOAPIFY, suggestPath('5 Fix')),
    ]) {
      const error: unknown = await call.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DOMException);
      expect(error instanceof DOMException ? error.name : null).toBe('TimeoutError');
    }
  });

  it('the call is recorded', async () => {
    const outbound = createFakeOutbound();
    fakeCensusGeocoder(outbound, {});
    fakeAddressSuggestions(outbound, {});
    await outbound.fetch(CENSUS, censusPath('6 Fixture Way'), { method: 'GET' });
    await outbound.fetch(GEOAPIFY, suggestPath('6 Fix'));
    expect(outbound.calls).toEqual([
      { host: CENSUS, method: 'GET', path: censusPath('6 Fixture Way'), headers: {}, body: null },
      { host: GEOAPIFY, method: 'GET', path: suggestPath('6 Fix'), headers: {}, body: null },
    ]);
  });
});

describe('fakeAddressSuggestions', () => {
  it('answers with the defaults filled in', async () => {
    const outbound = createFakeOutbound();
    fakeAddressSuggestions(outbound, {
      '1 Fix': [
        { formatted: '1 Fixture Way, Fixture City, ZZ', lat: 30.1, lon: -39.9 },
        { formatted: '1 Fixture Rd', lat: 30.2, lon: -39.8, country_code: 'ca' },
        { formatted: '1 Fixture Ct', lat: 30.3, lon: -39.7, result_type: 'building' },
      ],
      '2 Fix': '5xx',
    });
    const response = await outbound.fetch(GEOAPIFY, suggestPath('1 Fix'));
    expect(await response.json()).toEqual({
      results: [
        {
          formatted: '1 Fixture Way, Fixture City, ZZ',
          lat: 30.1,
          lon: -39.9,
          country_code: 'us',
          result_type: 'street',
        },
        {
          formatted: '1 Fixture Rd',
          lat: 30.2,
          lon: -39.8,
          country_code: 'ca',
          result_type: 'street',
        },
        {
          formatted: '1 Fixture Ct',
          lat: 30.3,
          lon: -39.7,
          country_code: 'us',
          result_type: 'building',
        },
      ],
    });
    expect((await outbound.fetch(GEOAPIFY, suggestPath('2 Fix'))).status).toBe(503);
    expect(await (await outbound.fetch(GEOAPIFY, suggestPath('3 Fix'))).json()).toEqual({
      results: [],
    });
  });
});
