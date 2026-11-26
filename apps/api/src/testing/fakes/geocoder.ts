import type { FakeOutbound, FakeRequest, FakeResponse } from './outbound.ts';

/** How the fake Census Geocoder answers one address (TEST-fake-geocoder). */
export type FakeCensusAnswer =
  | {
      kind: 'match';
      lat: number;
      lng: number;
      geographies: Readonly<Record<string, ReadonlyArray<{ GEOID: string }>>>;
    }
  | 'no_match'
  | 'timeout'
  | '5xx'
  | '4xx'
  | 'garbled';

/** How the fake suggestion provider answers one typed text (TEST-fake-geocoder). */
export type FakeSuggestionsAnswer =
  | ReadonlyArray<{
      formatted: string;
      lat: number;
      lon: number;
      country_code?: string;
      result_type?: string;
    }>
  | 'timeout'
  | '5xx';

const CENSUS_HOST = 'geocoding.geo.census.gov';
const CENSUS_PATH = /^\/geocoder\/geographies\/onelineaddress\?/;
const GEOAPIFY_HOST = 'api.geoapify.com';
const GEOAPIFY_PATH = /^\/v1\/geocode\/autocomplete\?/;

/** The value of `name` in the request path's query, or the empty string. */
function queryValue(request: FakeRequest, name: string): string {
  const start = request.path.indexOf('?');
  return start === -1 ? '' : (new URLSearchParams(request.path.slice(start + 1)).get(name) ?? '');
}

// What a request that ran past its timeout rejects with.
function timedOut(): never {
  throw new DOMException('The operation timed out.', 'TimeoutError');
}

function answerFor<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function censusResponse(address: string, answer: FakeCensusAnswer): FakeResponse {
  if (answer === 'timeout') {
    return timedOut();
  }
  if (answer === '5xx') {
    return { status: 503, body: `Service unavailable for ${address}` };
  }
  if (answer === '4xx') {
    return { status: 400, json: { errors: ['Address cannot be empty'] } };
  }
  if (answer === 'garbled') {
    return { status: 200, json: { unexpected: true } };
  }
  const input = { address: { address } };
  if (answer === 'no_match') {
    return { status: 200, json: { result: { input, addressMatches: [] } } };
  }
  // The real geocoder echoes the input twice, so a test proves nothing keeps or logs it.
  return {
    status: 200,
    json: {
      result: {
        input,
        addressMatches: [
          {
            matchedAddress: address,
            coordinates: { x: answer.lng, y: answer.lat },
            geographies: answer.geographies,
          },
        ],
      },
    },
  };
}

/**
 * Registers the Census Geocoder's one-line address route on `outbound`, answering each `address`
 * from `table`; an address the table lacks has no match. The calls stay on `outbound.calls`.
 */
export function fakeCensusGeocoder(
  outbound: FakeOutbound,
  table: Readonly<Record<string, FakeCensusAnswer>>,
): void {
  outbound.on(CENSUS_HOST, 'GET', CENSUS_PATH, (request) => {
    const address = queryValue(request, 'address');
    return censusResponse(address, answerFor(table, address) ?? 'no_match');
  });
}

/**
 * Registers the suggestion provider's autocomplete route on `outbound`, answering each `text` from
 * `table`; a text the table lacks has no results. Each result's `country_code` defaults to `us` and
 * its `result_type` to `street`. The calls stay on `outbound.calls`.
 */
export function fakeAddressSuggestions(
  outbound: FakeOutbound,
  table: Readonly<Record<string, FakeSuggestionsAnswer>>,
): void {
  outbound.on(GEOAPIFY_HOST, 'GET', GEOAPIFY_PATH, (request) => {
    const answer = answerFor(table, queryValue(request, 'text')) ?? [];
    if (answer === 'timeout') {
      return timedOut();
    }
    if (answer === '5xx') {
      return { status: 503, json: { statusCode: 503, error: 'Service Unavailable' } };
    }
    return {
      status: 200,
      json: {
        results: answer.map((result) => ({
          country_code: 'us',
          result_type: 'street',
          ...result,
        })),
      },
    };
  });
}
