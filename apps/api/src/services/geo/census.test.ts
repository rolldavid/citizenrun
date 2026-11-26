import { FakeClock, marker } from '@citizenrun/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCensusGeocoder } from '../../testing/fakes/geocoder.ts';
import type { FakeCensusAnswer } from '../../testing/fakes/geocoder.ts';
import { createFakeOutbound } from '../../testing/fakes/outbound.ts';
import type { FakeOutbound, FakeResponse } from '../../testing/fakes/outbound.ts';
import { createUnitDeps } from '../../testing/unit-deps.ts';
import { CensusUnavailableError, censusOf, createCensusGeocoder } from './census.ts';
import type { CensusGeocoder } from './census.ts';

const HOST = 'geocoding.geo.census.gov';
const PATH = /^\/geocoder\/geographies\/onelineaddress\?/;
const ADDRESS = '1 Fixture Way, Fixture City, ZZ 00012';
const FIXED_MESSAGE = 'The address lookup service is unavailable.';

const MATCH: FakeCensusAnswer = {
  kind: 'match',
  lat: 30.004321,
  lng: -39.995678,
  geographies: {
    States: [{ GEOID: '99' }],
    Counties: [{ GEOID: '99001' }],
    '120th Congressional Districts': [{ GEOID: '9901' }],
    '2026 State Legislative Districts - Upper': [{ GEOID: '99002' }],
    'Census Tracts': [{ GEOID: '99001000100' }],
  },
};

function setup(table: Readonly<Record<string, FakeCensusAnswer>>): {
  outbound: FakeOutbound;
  clock: FakeClock;
  census: CensusGeocoder;
} {
  const outbound = createFakeOutbound();
  fakeCensusGeocoder(outbound, table);
  const clock = new FakeClock('2026-11-26T12:00:00.000Z');
  return { outbound, clock, census: createCensusGeocoder(outbound.fetch, clock) };
}

// A geocoder whose attempts are answered in turn by `answers`; past the end, by the last one.
function sequenced(answers: ReadonlyArray<() => FakeResponse>): {
  outbound: FakeOutbound;
  clock: FakeClock;
  census: CensusGeocoder;
} {
  const outbound = createFakeOutbound();
  let next = 0;
  outbound.on(HOST, 'GET', PATH, () => {
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    if (answer === undefined) {
      throw new Error('no answer');
    }
    return answer();
  });
  const clock = new FakeClock('2026-11-26T12:00:00.000Z');
  return { outbound, clock, census: createCensusGeocoder(outbound.fetch, clock) };
}

const timeout = (): FakeResponse => {
  throw new DOMException('The operation timed out.', 'TimeoutError');
};
const matchAnswer = (): FakeResponse => ({
  status: 200,
  json: {
    result: {
      addressMatches: [{ coordinates: { x: -39.995678, y: 30.004321 }, geographies: {} }],
    },
  },
});

async function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => {
      throw new Error('the call did not fail');
    },
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCensusGeocoder', () => {
  it('asks for geographies with every layer', async () => {
    const { outbound, census } = setup({ [ADDRESS]: MATCH });
    await census.geocode(ADDRESS);
    expect(outbound.calls).toHaveLength(1);
    const call = outbound.calls[0];
    expect(call?.host).toBe(HOST);
    expect(call?.method).toBe('GET');
    expect(call?.path.startsWith('/geocoder/geographies/onelineaddress?')).toBe(true);
    const path = call?.path ?? '';
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect([...query.keys()].sort()).toEqual([
      'address',
      'benchmark',
      'format',
      'layers',
      'vintage',
    ]);
    expect(Object.fromEntries(query)).toEqual({
      address: ADDRESS,
      benchmark: 'Public_AR_Current',
      vintage: 'Current_Current',
      layers: 'all',
      format: 'json',
    });
    // No cookie, no authorization, no client address: no header at all, and no body.
    expect(call?.headers).toEqual({});
    expect(call?.body).toBeNull();
  });

  it('a match gives the point and the known layers', async () => {
    const { census } = setup({ [ADDRESS]: MATCH });
    const result = await census.geocode(ADDRESS);
    expect(result).toEqual({
      kind: 'match',
      match: {
        lat: 30.004321,
        lng: -39.995678,
        layers: [
          { token: 'state', geoid: '99' },
          { token: 'county', geoid: '99001' },
          { token: 'cd', geoid: '9901' },
          { token: 'sldu', geoid: '99002' },
        ],
      },
    });
  });

  it('every known layer name gives its token, and an empty layer gives none', async () => {
    const { census } = setup({
      [ADDRESS]: {
        kind: 'match',
        lat: 30.1,
        lng: -39.9,
        geographies: {
          'County Subdivisions': [{ GEOID: '9900190000' }],
          'Incorporated Places': [{ GEOID: '9912345' }, { GEOID: '9954321' }],
          '2026 State Legislative Districts - Lower': [{ GEOID: '99003' }],
          'Unified School Districts': [{ GEOID: '9900001' }],
          'Census Designated Places': [],
        },
      },
    });
    const result = await census.geocode(ADDRESS);
    expect(result.kind === 'match' ? result.match.layers : []).toEqual([
      { token: 'cousub', geoid: '9900190000' },
      { token: 'place', geoid: '9912345' },
      { token: 'sldl', geoid: '99003' },
      { token: 'unsd', geoid: '9900001' },
    ]);
  });

  it('a layer of another vintage is not used', async () => {
    const { census } = setup({
      [ADDRESS]: {
        kind: 'match',
        lat: 30.1,
        lng: -39.9,
        geographies: {
          States: [{ GEOID: '99' }],
          '121st Congressional Districts': [{ GEOID: '9902' }],
          '2028 State Legislative Districts - Upper': [{ GEOID: '99009' }],
        },
      },
    });
    const result = await census.geocode(ADDRESS);
    expect(result.kind === 'match' ? result.match.layers : []).toEqual([
      { token: 'state', geoid: '99' },
    ]);
  });

  it('no match', async () => {
    const { outbound, census } = setup({ [ADDRESS]: 'no_match' });
    expect(await census.geocode(ADDRESS)).toEqual({ kind: 'no_match' });
    expect(await census.geocode('2 Unknown Fixture Rd')).toEqual({ kind: 'no_match' });
    expect(outbound.calls).toHaveLength(2);
  });

  it('a timeout is retried once', async () => {
    const { outbound, census } = sequenced([timeout, matchAnswer]);
    const result = await census.geocode(ADDRESS);
    expect(result.kind).toBe('match');
    expect(outbound.calls).toHaveLength(2);
  });

  it('a network error is retried once', async () => {
    const { outbound, census } = sequenced([
      () => {
        throw new TypeError('fetch failed');
      },
      matchAnswer,
    ]);
    expect((await census.geocode(ADDRESS)).kind).toBe('match');
    expect(outbound.calls).toHaveLength(2);
  });

  it('a 5xx is retried once', async () => {
    const { outbound, census } = sequenced([
      () => ({ status: 502, body: 'bad gateway' }),
      matchAnswer,
    ]);
    expect((await census.geocode(ADDRESS)).kind).toBe('match');
    expect(outbound.calls).toHaveLength(2);

    const twice = setup({ [ADDRESS]: '5xx' });
    expect(await failure(twice.census.geocode(ADDRESS))).toBeInstanceOf(CensusUnavailableError);
    expect(twice.outbound.calls).toHaveLength(2);
  });

  it('a 4xx is not retried', async () => {
    const { outbound, census } = setup({ [ADDRESS]: '4xx' });
    const error = await failure(census.geocode(ADDRESS));
    expect(error).toBeInstanceOf(CensusUnavailableError);
    expect(outbound.calls).toHaveLength(1);
  });

  it('a garbled body counts as a failure', async () => {
    const { outbound, census } = setup({ [ADDRESS]: 'garbled' });
    expect(await failure(census.geocode(ADDRESS))).toBeInstanceOf(CensusUnavailableError);
    // It is retried like a 5xx.
    expect(outbound.calls).toHaveLength(2);

    const notJson = sequenced([() => ({ status: 200, body: '<html>' }), matchAnswer]);
    expect((await notJson.census.geocode(ADDRESS)).kind).toBe('match');
    expect(notJson.outbound.calls).toHaveLength(2);
  });

  it('the breaker opens after five failed calls', async () => {
    const { outbound, clock, census } = setup({ [ADDRESS]: 'timeout', match: MATCH });
    for (let call = 1; call <= 5; call += 1) {
      if (call > 1) {
        clock.advance(1_000);
      }
      expect(await failure(census.geocode(ADDRESS))).toBeInstanceOf(CensusUnavailableError);
    }
    expect(outbound.calls).toHaveLength(10);

    // Open: no request.
    clock.advance(1_000);
    expect(await failure(census.geocode('match'))).toBeInstanceOf(CensusUnavailableError);
    expect(outbound.calls).toHaveLength(10);
    // 59,999 ms after the fifth failure: still open.
    clock.advance(58_999);
    expect(await failure(census.geocode('match'))).toBeInstanceOf(CensusUnavailableError);
    expect(outbound.calls).toHaveLength(10);
    // 60,000 ms after it: the next call is attempted.
    clock.advance(1);
    expect((await census.geocode('match')).kind).toBe('match');
    expect(outbound.calls).toHaveLength(11);

    // That success reset the count: one more failed call does not open the breaker.
    clock.advance(1_000);
    expect(await failure(census.geocode(ADDRESS))).toBeInstanceOf(CensusUnavailableError);
    expect(outbound.calls).toHaveLength(13);
    clock.advance(1_000);
    expect((await census.geocode('match')).kind).toBe('match');
    expect(outbound.calls).toHaveLength(14);
  });

  it('a failure after the breaker closes opens it again', async () => {
    const { outbound, clock, census } = setup({ [ADDRESS]: 'timeout' });
    for (let call = 1; call <= 5; call += 1) {
      clock.advance(1_000);
      await failure(census.geocode(ADDRESS));
    }
    clock.advance(60_000);
    await failure(census.geocode(ADDRESS));
    expect(outbound.calls).toHaveLength(12);
    clock.advance(1_000);
    await failure(census.geocode(ADDRESS));
    expect(outbound.calls).toHaveLength(12);
  });

  it('at most five attempts a second', async () => {
    const { outbound, clock, census } = setup({ [ADDRESS]: MATCH });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () => census.geocode(ADDRESS)),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'rejected',
    ]);
    const refused = outcomes[5];
    expect(refused?.status === 'rejected' ? refused.reason : null).toBeInstanceOf(
      CensusUnavailableError,
    );
    expect(outbound.calls).toHaveLength(5);

    // Five more refusals at the same instant: if refusals counted, the breaker would now be open.
    for (let call = 0; call < 5; call += 1) {
      expect(await failure(census.geocode(ADDRESS))).toBeInstanceOf(CensusUnavailableError);
    }
    expect(outbound.calls).toHaveLength(5);

    // An attempt started exactly 1,000 ms ago no longer counts.
    clock.advance(1_000);
    expect((await census.geocode(ADDRESS)).kind).toBe('match');
    expect(outbound.calls).toHaveLength(6);
  });

  it('the limiter counts attempts, retries included', async () => {
    const { outbound, census } = setup({ [ADDRESS]: '5xx', match: MATCH });
    // Two failed calls of two attempts each, then a third call's first attempt is the fifth.
    await failure(census.geocode(ADDRESS));
    await failure(census.geocode(ADDRESS));
    expect(outbound.calls).toHaveLength(4);
    expect((await census.geocode('match')).kind).toBe('match');
    expect(outbound.calls).toHaveLength(5);
    expect(await failure(census.geocode('match'))).toBeInstanceOf(CensusUnavailableError);
    expect(outbound.calls).toHaveLength(5);
  });

  it('the answer and the error never carry the address', async () => {
    const address = `1 ${marker()} Way`;
    const outbound = createFakeOutbound();
    fakeCensusGeocoder(outbound, { [address]: '5xx', [`${address} match`]: MATCH });
    const deps = { ...createUnitDeps(), outbound: outbound.fetch };
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const error = await failure(censusOf(deps).geocode(address));
    expect(error).toBeInstanceOf(CensusUnavailableError);
    expect(error instanceof Error ? error.message : '').toBe(FIXED_MESSAGE);
    expect(error instanceof Error ? error.cause : null).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(marker());
    expect(String(error instanceof Error ? error.stack : '')).not.toContain(marker());
    // The 5xx body held the address; the outbound calls are the only place it went.
    expect(outbound.calls.every((call) => call.host === HOST)).toBe(true);

    // A match keeps no echo of the input.
    const result = await censusOf(deps).geocode(`${address} match`);
    expect(JSON.stringify(result)).not.toContain(marker());

    expect(deps.logs.filter((line) => line.raw.includes(marker()))).toEqual([]);
    expect(deps.logs).toEqual([]);
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('censusOf', () => {
  it('one geocoder per Deps', async () => {
    const outbound = createFakeOutbound();
    fakeCensusGeocoder(outbound, { [ADDRESS]: '4xx' });
    const first = { ...createUnitDeps(), outbound: outbound.fetch };
    const second = { ...createUnitDeps(), outbound: outbound.fetch };
    expect(censusOf(first)).toBe(censusOf(first));
    expect(censusOf(second)).not.toBe(censusOf(first));

    // Five failures open the first geocoder's breaker and leave the second one's shut.
    for (let call = 0; call < 5; call += 1) {
      first.clock.advance(1_000);
      await failure(censusOf(first).geocode(ADDRESS));
    }
    expect(outbound.calls).toHaveLength(5);
    first.clock.advance(1_000);
    await failure(censusOf(first).geocode(ADDRESS));
    expect(outbound.calls).toHaveLength(5);
    await failure(censusOf(second).geocode(ADDRESS));
    expect(outbound.calls).toHaveLength(6);
  });
});
