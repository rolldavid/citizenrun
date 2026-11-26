import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import { bucketKeys } from './bucket.ts';
import { makeFetcher, removeStateDirs, robotsAnswer } from './fetch/test-fakes.ts';
import type { Handler, Scripted } from './fetch/test-fakes.ts';
import { productToken } from './fetch/user-agent.ts';
import { ReachabilityReportSchema, chooseListLink, probeReachability } from './reachability.ts';
import type { ReachabilityTarget } from './reachability.ts';

const NOW = '2026-11-26T05:30:12.000Z';
const LIST_BODY = 'name,street\nFixture Person,1 Fixture Way\n';

afterEach(async () => {
  await removeStateDirs();
});

const csv = (body = LIST_BODY): Scripted => ({
  status: 200,
  headers: {
    'content-type': 'text/csv',
    etag: '"fixture"',
    'last-modified': 'Wed, 25 Nov 2026 07:00:00 GMT',
  },
  body,
});

const discoverPage = `<html><body>
  <a href="/files/Candidate_Listing_2025.csv">2025</a>
  <a href="https://lists.example.test/files/Candidate_Listing_2026.csv">2026</a>
  <a href="/files/Other_2027.csv">other</a>
</body></html>`;

function handler(robots: Readonly<Record<string, Scripted>> = {}): Handler {
  return (_req, url) => {
    if (url.pathname === '/robots.txt') {
      return robotsAnswer(url, robots);
    }
    if (url.pathname === '/candidate-lists') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: discoverPage };
    }
    if (url.pathname.endsWith('.csv')) {
      return csv();
    }
    return { status: 404 };
  };
}

const getTarget: ReachabilityTarget = {
  state: 'VA',
  source: 'va-elections',
  kind: 'get',
  url: 'https://lists.example.test/files/list.csv',
  linkPattern: null,
};

const discoverTarget: ReachabilityTarget = {
  state: 'NC',
  source: 'nc-sbe',
  kind: 'discover_get',
  url: 'https://lists.example.test/candidate-lists',
  linkPattern: 'Candidate_Listing_\\d{4}\\.csv$',
};

describe('probeReachability', () => {
  it('reports robots and list status without body content', async () => {
    const bucket = createMemoryBucket();
    const { fetcher } = await makeFetcher({ bucket, handler: handler() });
    const report = await probeReachability(fetcher, bucket, [getTarget], NOW);
    expect(ReachabilityReportSchema.parse(report)).toEqual(report);
    expect(report).toEqual({
      generated_at: NOW,
      from: 'owner_machine',
      product_token: productToken(),
      results: [
        {
          state: 'VA',
          source: 'va-elections',
          kind: 'get',
          target: getTarget.url,
          host: 'lists.example.test',
          robots_status: 404,
          robots: 'absent',
          result: 'ok',
          status: 200,
          challenge: false,
          etag_present: true,
          last_modified_present: true,
          discovered: null,
        },
      ],
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain('Fixture Person');
    expect(text).not.toContain('Fixture Way');
  });

  it('discover_get picks the newest matching link', async () => {
    const bucket = createMemoryBucket();
    const { fetcher, transport } = await makeFetcher({ bucket, handler: handler() });
    const report = await probeReachability(fetcher, bucket, [discoverTarget], NOW);
    expect(report.results[0]).toMatchObject({
      result: 'ok',
      status: 200,
      discovered: 'https://lists.example.test/files/Candidate_Listing_2026.csv',
    });
    expect(transport.pages().map((req) => req.path)).toEqual([
      '/candidate-lists',
      '/files/Candidate_Listing_2026.csv',
    ]);
    expect(chooseListLink(discoverPage, discoverTarget.url, discoverTarget.linkPattern ?? '')).toBe(
      'https://lists.example.test/files/Candidate_Listing_2026.csv',
    );
  });

  it('a disallowed list path is not fetched', async () => {
    const bucket = createMemoryBucket();
    const { fetcher, transport } = await makeFetcher({
      bucket,
      handler: handler({
        'lists.example.test': { status: 200, body: 'User-agent: *\nDisallow: /files/\n' },
      }),
    });
    const report = await probeReachability(fetcher, bucket, [getTarget, discoverTarget], NOW);
    expect(report.results.map((row) => [row.robots, row.result, row.discovered])).toEqual([
      ['disallowed', 'disallowed', null],
      ['allowed', 'disallowed', 'https://lists.example.test/files/Candidate_Listing_2026.csv'],
    ]);
    expect(transport.pages().map((req) => req.path)).toEqual(['/candidate-lists']);
    expect(bucket.keys().filter((key) => key.startsWith('raw/'))).toEqual([]);
  });

  it('a list never reaches cache/raw', async () => {
    const bucket = createMemoryBucket();
    const { fetcher } = await makeFetcher({ bucket, handler: handler() });
    await probeReachability(fetcher, bucket, [getTarget, discoverTarget], NOW);
    const cached = bucket.keys().filter((key) => key.startsWith('cache/raw/'));
    expect(cached).toHaveLength(1);
    const page = new TextDecoder().decode(
      (await bucket.getBytes(cached[0] ?? '')) ?? new Uint8Array(),
    );
    expect(page).toBe(discoverPage);
    expect(bucket.keys().filter((key) => key.startsWith('raw/'))).toEqual([
      bucketKeys.rawFilings('NC', '2026-11-26', 'nc-sbe', '053012', 'csv'),
      bucketKeys.rawFilingsSidecar('NC', '2026-11-26', 'nc-sbe', '053012'),
      bucketKeys.rawFilings('VA', '2026-11-26', 'va-elections', '053012', 'csv'),
      bucketKeys.rawFilingsSidecar('VA', '2026-11-26', 'va-elections', '053012'),
    ]);
    const sidecar = JSON.parse(
      new TextDecoder().decode(
        (await bucket.getBytes(
          bucketKeys.rawFilingsSidecar('VA', '2026-11-26', 'va-elections', '053012'),
        )) ?? new Uint8Array(),
      ),
    ) as Record<string, unknown>;
    expect(sidecar).toMatchObject({
      url: getTarget.url,
      fetched_at: NOW,
      status: 200,
      etag: '"fixture"',
      last_modified: 'Wed, 25 Nov 2026 07:00:00 GMT',
      bytes: new TextEncoder().encode(LIST_BODY).byteLength,
    });
  });

  it('a challenged robots.txt is reported and nothing else is requested', async () => {
    const bucket = createMemoryBucket();
    const { fetcher, transport } = await makeFetcher({
      bucket,
      handler: handler({
        'lists.example.test': { status: 403, body: '<title>Just a moment...</title>' },
      }),
    });
    const report = await probeReachability(fetcher, bucket, [getTarget], NOW);
    expect(report.results[0]).toMatchObject({
      robots: 'challenge',
      robots_status: 403,
      result: 'challenge',
      challenge: true,
      status: 403,
    });
    expect(transport.pages()).toHaveLength(0);
  });
});
