import { describe, expect, it } from 'vitest';
import { fakeAddressSuggestions } from '../../../testing/fakes/geocoder.ts';
import type { FakeSuggestionsAnswer } from '../../../testing/fakes/geocoder.ts';
import { createFakeOutbound } from '../../../testing/fakes/outbound.ts';
import type { FakeOutbound } from '../../../testing/fakes/outbound.ts';
import { createUnitDeps } from '../../../testing/unit-deps.ts';
import { GeoProviderError, createGeoapifyProvider, noneProvider, providerOf } from './index.ts';

// A fixture key, never a real one.
const FIXTURE_GEO_KEY = 'fixture-geo-key';
const HOST = 'api.geoapify.com';
const TYPED = '1 Fixture Way';

function setup(table: Readonly<Record<string, FakeSuggestionsAnswer>> = {}): {
  outbound: FakeOutbound;
  suggest: (
    q: string,
    limit?: number,
  ) => ReturnType<ReturnType<typeof createGeoapifyProvider>['suggest']>;
} {
  const outbound = createFakeOutbound();
  fakeAddressSuggestions(outbound, table);
  const provider = createGeoapifyProvider(outbound.fetch, FIXTURE_GEO_KEY);
  return {
    outbound,
    suggest: (q, limit = 5) => provider.suggest(q, { limit, signal: new AbortController().signal }),
  };
}

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.slice(path.indexOf('?') + 1));
}

describe('createGeoapifyProvider', () => {
  it('sends only the text, the filter, the limit, the format and the key', async () => {
    const { outbound, suggest } = setup({ [TYPED]: [] });
    await suggest(TYPED);
    expect(outbound.calls).toHaveLength(1);
    const call = outbound.calls[0];
    expect(call?.host).toBe(HOST);
    expect(call?.method).toBe('GET');
    expect(call?.path.startsWith('/v1/geocode/autocomplete?')).toBe(true);
    const query = queryOf(call?.path ?? '');
    expect([...query.keys()].sort()).toEqual(['apiKey', 'filter', 'format', 'limit', 'text']);
    expect(Object.fromEntries(query)).toEqual({
      text: TYPED,
      filter: 'countrycode:us',
      limit: '5',
      format: 'json',
      apiKey: FIXTURE_GEO_KEY,
    });
    // No header and no body: nothing that names the user or the client.
    expect(call?.headers).toEqual({});
    expect(call?.body).toBeNull();
  });

  it('the limit sent is five whatever the caller asks', async () => {
    const { outbound, suggest } = setup();
    await suggest(TYPED, 2);
    expect(queryOf(outbound.calls[0]?.path ?? '').get('limit')).toBe('5');
  });

  it('maps building to exact and the rest to approx', async () => {
    const { suggest } = setup({
      [TYPED]: [
        {
          formatted: '1 Fixture Way, Fixture City, ZZ',
          lat: 30.1,
          lon: -39.9,
          result_type: 'building',
        },
        { formatted: '1 Fixture Way, Fixture New City, ZZ', lat: 30.2, lon: -39.8 },
        { formatted: 'Fixture Way, ZZ', lat: 30.3, lon: -39.7, result_type: 'amenity' },
      ],
    });
    expect(await suggest(TYPED)).toEqual([
      {
        label: '1 Fixture Way, Fixture City, ZZ',
        lat: 30.1,
        lng: -39.9,
        precision: 'exact',
        kind: 'address',
      },
      {
        label: '1 Fixture Way, Fixture New City, ZZ',
        lat: 30.2,
        lng: -39.8,
        precision: 'approx',
        kind: 'address',
      },
      { label: 'Fixture Way, ZZ', lat: 30.3, lng: -39.7, precision: 'approx', kind: 'address' },
    ]);
  });

  it('drops a result outside the United States or without coordinates', async () => {
    const outbound = createFakeOutbound();
    outbound.on(HOST, 'GET', /^\/v1\/geocode\/autocomplete\?/, () => ({
      status: 200,
      json: {
        results: [
          { formatted: 'Abroad', lat: 45.1, lon: -75.1, country_code: 'ca' },
          { formatted: 'No country', lat: 30.1, lon: -39.9 },
          { formatted: 'No latitude', lon: -39.9, country_code: 'us' },
          { formatted: 'No longitude', lat: 30.1, country_code: 'us' },
          { lat: 30.1, lon: -39.9, country_code: 'us' },
          { formatted: '', lat: 30.1, lon: -39.9, country_code: 'us' },
          { formatted: 'Kept', lat: 30.1, lon: -39.9, country_code: 'us', extra: { a: 1 } },
        ],
      },
    }));
    const provider = createGeoapifyProvider(outbound.fetch, FIXTURE_GEO_KEY);
    const suggestions = await provider.suggest(TYPED, {
      limit: 5,
      signal: new AbortController().signal,
    });
    expect(suggestions).toEqual([
      { label: 'Kept', lat: 30.1, lng: -39.9, precision: 'approx', kind: 'address' },
    ]);
  });

  it('answers at most the limit', async () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({
      formatted: `${String(index)} Fixture Way`,
      lat: 30 + index / 100,
      lon: -39.9,
    }));
    const { suggest } = setup({ [TYPED]: seven });
    expect((await suggest(TYPED)).map((item) => item.label)).toEqual(
      seven.slice(0, 5).map((item) => item.formatted),
    );
    expect(await suggest(TYPED, 2)).toHaveLength(2);
  });

  it('cuts a long label to 200 characters', async () => {
    const long = `1 Fixture Way ${'x'.repeat(300)}`;
    const { suggest } = setup({ [TYPED]: [{ formatted: long, lat: 30.1, lon: -39.9 }] });
    const [first] = await suggest(TYPED);
    expect(first?.label).toBe(long.slice(0, 200));
    expect(first?.label).toHaveLength(200);
  });

  it('rounds coordinates to six decimals', async () => {
    const { suggest } = setup({
      [TYPED]: [
        { formatted: 'North', lat: 35.77958974, lon: -78.63817871 },
        { formatted: 'Half', lat: 30.0000005, lon: -39.0000005 },
      ],
    });
    const [north, half] = await suggest(TYPED);
    expect([north?.lat, north?.lng]).toEqual([35.77959, -78.638179]);
    // Halves round away from zero.
    expect([half?.lat, half?.lng]).toEqual([30.000001, -39.000001]);
  });

  it('a 5xx and a garbled body reject with the fixed message', async () => {
    const { suggest } = setup({ [TYPED]: '5xx' });
    await expect(suggest(TYPED)).rejects.toThrow(new GeoProviderError());
    for (const answer of [
      { status: 200, json: { unexpected: true } },
      { status: 200, json: { results: [{ formatted: 'x', lat: '30.1', lon: -39.9 }] } },
      { status: 200, body: 'not json' },
      { status: 429, json: { message: TYPED } },
      { status: 401, json: { message: FIXTURE_GEO_KEY } },
    ]) {
      const outbound = createFakeOutbound();
      outbound.on(HOST, 'GET', /^\/v1\//, () => answer);
      const provider = createGeoapifyProvider(outbound.fetch, FIXTURE_GEO_KEY);
      const error: unknown = await provider
        .suggest(TYPED, { limit: 5, signal: new AbortController().signal })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GeoProviderError);
      expect(error instanceof Error ? error.message : '').toBe('Address suggestions failed.');
      expect(JSON.stringify(error)).not.toContain(FIXTURE_GEO_KEY);
      expect(error instanceof Error ? error.cause : null).toBeUndefined();
    }
  });

  it('a timeout rejects with the fixed message and is not retried', async () => {
    const { outbound, suggest } = setup({ [TYPED]: 'timeout' });
    const error: unknown = await suggest(TYPED).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeoProviderError);
    expect(outbound.calls).toHaveLength(1);
  });

  it("an aborted caller's signal makes no request", async () => {
    const { outbound } = setup({ [TYPED]: [] });
    const provider = createGeoapifyProvider(outbound.fetch, FIXTURE_GEO_KEY);
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.suggest(TYPED, { limit: 5, signal: controller.signal }),
    ).rejects.toBeInstanceOf(GeoProviderError);
    expect(outbound.calls).toHaveLength(0);
  });
});

describe('noneProvider', () => {
  it('answers nothing and calls nothing', async () => {
    expect(noneProvider.name).toBe('none');
    expect(
      await noneProvider.suggest(TYPED, { limit: 5, signal: new AbortController().signal }),
    ).toEqual([]);
  });
});

describe('providerOf', () => {
  it('none without a key, whatever GEO_PROVIDER says', () => {
    expect(providerOf(createUnitDeps())).toBe(noneProvider);
    expect(providerOf(createUnitDeps({ env: { GEO_PROVIDER: 'geoapify' } }))).toBe(noneProvider);
    expect(providerOf(createUnitDeps({ env: { GEO_API_KEY: FIXTURE_GEO_KEY } }))).toBe(
      noneProvider,
    );
  });

  it('geoapify with its key, one per Deps', async () => {
    const outbound = createFakeOutbound();
    fakeAddressSuggestions(outbound, { [TYPED]: [{ formatted: TYPED, lat: 30.1, lon: -39.9 }] });
    const make = () => ({
      ...createUnitDeps({ env: { GEO_PROVIDER: 'geoapify', GEO_API_KEY: FIXTURE_GEO_KEY } }),
      outbound: outbound.fetch,
    });
    const deps = make();
    const provider = providerOf(deps);
    expect(provider.name).toBe('geoapify');
    expect(providerOf(deps)).toBe(provider);
    expect(providerOf(make())).not.toBe(provider);
    expect(
      await provider.suggest(TYPED, { limit: 5, signal: new AbortController().signal }),
    ).toHaveLength(1);
    expect(queryOf(outbound.calls[0]?.path ?? '').get('apiKey')).toBe(FIXTURE_GEO_KEY);
  });
});
