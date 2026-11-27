import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import { s09Context, saved, scriptFetcher } from '../__fixtures__/s09/zz-s09.ts';
import { WikidataQidError, WikidataQueryError, currentHolders, holdersQuery } from './wikidata.ts';

describe('currentHolders', () => {
  it('the saved response gives the holders', async () => {
    const bucket = createMemoryBucket();
    // North Carolina State Treasurer (Q7054613). Wikidata gives six items whose P39 statement has
    // no end time; one has no English label (its label is its id), so it names no one.
    const body = (await saved('wikidata-holders.json')).bytes;
    const fetcher = scriptFetcher(bucket, () => ({
      body,
      contentType: 'application/sparql-results+json',
    }));
    const holders = await currentHolders(s09Context(bucket, fetcher), 'Q7054613');
    expect(holders).toEqual([
      { personQid: 'Q4889151', label: 'Benjamin R. Lacy', enwikiTitle: 'Benjamin R. Lacy' },
      { personQid: 'Q5210439', label: 'Dale Folwell', enwikiTitle: 'Dale Folwell' },
      { personQid: 'Q7326170', label: 'Richard H. Moore', enwikiTitle: 'Richard H. Moore' },
      { personQid: 'Q7411349', label: 'Samuel F. Patterson', enwikiTitle: 'Samuel F. Patterson' },
      {
        personQid: 'Q109517089',
        label: 'Samuel McDowell Tate',
        enwikiTitle: 'Samuel McDowell Tate',
      },
    ]);
    const req = fetcher.requests[0]?.req;
    expect(req?.class).toBe('api');
    expect(req?.headers).toEqual({ Accept: 'application/sparql-results+json' });
    const url = new URL(req?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://query.wikidata.org/sparql');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('query')).toBe(holdersQuery('Q7054613'));
    expect(holdersQuery('Q4115189')).toContain('?st ps:P39 wd:Q4115189 .');
    expect(holdersQuery('Q4115189')).toContain('FILTER NOT EXISTS { ?st pq:P582 ?end }');
  });

  it('a malformed Q-id is refused before a request', async () => {
    const bucket = createMemoryBucket();
    const fetcher = scriptFetcher(bucket, () => undefined);
    const ctx = s09Context(bucket, fetcher);
    for (const qid of ['Q', '4115189', 'Q41 } . ?x ?y ?z', 'q4115189', 'P39']) {
      await expect(currentHolders(ctx, qid)).rejects.toBeInstanceOf(WikidataQidError);
    }
    expect(fetcher.requests).toHaveLength(0);
  });

  it('a refused query is an error naming the reason', async () => {
    const bucket = createMemoryBucket();
    const fetcher = scriptFetcher(bucket, () => ({ kind: 'disallowed', reason: 'robots' }));
    await expect(currentHolders(s09Context(bucket, fetcher), 'Q1')).rejects.toMatchObject({
      constructor: WikidataQueryError,
      reason: 'robots',
    });
  });
});
