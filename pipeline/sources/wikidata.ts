// Current holders of a Wikidata position: items with a P39 statement of the position and no P582
// (end time) qualifier, a Medium-confidence second source for statewide offices (D-315).
import { z } from 'zod';
import type { RunContext } from '../lib/runner.ts';

export const SOURCE_IDS = ['wikidata'] as const;

export const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

export type WikidataHolder = { personQid: string; label: string; enwikiTitle: string | null };

/** A position id that is not `Q` and digits; refused before any request. */
export class WikidataQidError extends Error {
  override readonly name = 'WikidataQidError';

  constructor() {
    super('a Wikidata position id is Q followed by digits');
  }
}

/** The holders query could not be answered (refused, failed or not SPARQL JSON). */
export class WikidataQueryError extends Error {
  override readonly name = 'WikidataQueryError';
  readonly reason: string;

  constructor(reason: string) {
    super(`the Wikidata query failed: ${reason}`);
    this.reason = reason;
  }
}

const QID = /^Q\d+$/;
const ENTITY = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/;
const ARTICLE_PREFIX = 'https://en.wikipedia.org/wiki/';

/** The SPARQL text for the current holders of `qid`, which must already be validated. */
export function holdersQuery(qid: string): string {
  return [
    'SELECT ?person ?personLabel ?article WHERE {',
    `  ?person p:P39 ?st . ?st ps:P39 wd:${qid} .`,
    '  FILTER NOT EXISTS { ?st pq:P582 ?end }',
    '  OPTIONAL { ?article schema:about ?person ; schema:isPartOf <https://en.wikipedia.org/> . }',
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
    '}',
  ].join('\n');
}

const BindingValue = z.object({ value: z.string() });
const SparqlSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        person: BindingValue.optional(),
        personLabel: BindingValue.optional(),
        article: BindingValue.optional(),
      }),
    ),
  }),
});

function articleTitle(url: string): string | null {
  if (!url.startsWith(ARTICLE_PREFIX)) {
    return null;
  }
  const last = url.slice(url.lastIndexOf('/') + 1);
  try {
    const title = decodeURIComponent(last).replace(/_/g, ' ').trim();
    return title === '' ? null : title;
  } catch {
    return null;
  }
}

/**
 * The parsed holders of a SPARQL JSON answer, one per person item in answer order. A binding whose
 * label is only the item id (no English label) names no one and is dropped.
 */
export function parseHolders(json: unknown): readonly WikidataHolder[] {
  const parsed = SparqlSchema.safeParse(json);
  if (!parsed.success) {
    throw new WikidataQueryError('invalid_shape');
  }
  const byQid = new Map<string, WikidataHolder>();
  for (const binding of parsed.data.results.bindings) {
    const qid = ENTITY.exec(binding.person?.value ?? '')?.[1];
    const label = binding.personLabel?.value.replace(/\s+/g, ' ').trim() ?? '';
    if (qid === undefined || label === '' || QID.test(label)) {
      continue;
    }
    const title = binding.article === undefined ? null : articleTitle(binding.article.value);
    const known = byQid.get(qid);
    if (known === undefined) {
      byQid.set(qid, { personQid: qid, label, enwikiTitle: title });
    } else if (known.enwikiTitle === null && title !== null) {
      byQid.set(qid, { ...known, enwikiTitle: title });
    }
  }
  return [...byQid.values()];
}

/** The current holders of the position `qid` (one request). Throws on a bad id or a failed query. */
export async function currentHolders(
  ctx: RunContext,
  qid: string,
): Promise<readonly WikidataHolder[]> {
  if (!QID.test(qid)) {
    throw new WikidataQidError();
  }
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(holdersQuery(qid))}`;
  const result = await ctx.fetcher.fetch({
    url,
    class: 'api',
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (result.kind !== 'ok') {
    throw new WikidataQueryError(
      result.kind === 'disallowed' || result.kind === 'error' ? result.reason : result.kind,
    );
  }
  const bytes = await ctx.bucket.getBytes(result.cacheKey);
  if (bytes === null) {
    throw new WikidataQueryError('not_cached');
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new WikidataQueryError('invalid_json');
  }
  return parseHolders(json);
}
