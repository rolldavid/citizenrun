export type FetchClass =
  | 'dataset' // bulk downloads from statistical agencies and open-data hosts (stage 1, 2, 7, 11)
  | 'adapter' // candidate lists, results exports, forms (stage 8, 7, 12)
  | 'crawl' // government websites for stage 6, website validation, template quote grounding
  | 'api'; // Wikimedia, Wikidata, Congress.gov, ArcGIS and Socrata catalogs

export type FetchRequest = {
  readonly url: string; // https only; an http URL is upgraded to https first
  readonly class: FetchClass;
  readonly method?: 'GET' | 'HEAD' | 'POST';
  readonly body?: Uint8Array; // POST: replayed WebForms posts only
  readonly headers?: Readonly<Record<string, string>>; // never a cookie from a login; never Authorization except the api.data.gov key
  readonly conditional?: { readonly etag: string | null; readonly lastModified: string | null };
  readonly maxBytes?: number; // default: 20 MB pages, 200 MB datasets (streamed to the bucket)
  readonly state?: string; // the state the request serves, for business hours and election night
  readonly purpose?: string; // 'cache' (the default) or 'snapshot:<source id>': how a queued URL is finished by the local fetch (PIPE-host-registry)
};

export type FetchResult =
  | {
      readonly kind: 'ok';
      readonly finalUrl: string;
      readonly status: number;
      readonly contentType: string | null;
      readonly etag: string | null;
      readonly lastModified: string | null;
      readonly sha256: string;
      readonly bytes: number;
      readonly cacheKey: string; // cache/raw/<sha256>.<ext>
    }
  | { readonly kind: 'not_modified'; readonly finalUrl: string }
  | {
      readonly kind: 'disallowed';
      readonly reason:
        | 'robots'
        | 'robots_unavailable'
        | 'blocked_host'
        | 'business_hours'
        | 'daily_cap'
        | 'election_night'
        | 'not_https';
    }
  | { readonly kind: 'challenge'; readonly status: number }
  | {
      readonly kind: 'error';
      readonly status: number | null;
      readonly reason: 'timeout' | 'too_large' | 'network' | 'http_status' | 'too_many_redirects';
    };

export interface Fetcher {
  fetch(req: FetchRequest): Promise<FetchResult>;
  /** Streams the body into the data bucket under `key` instead of the cache (datasets). */
  download(req: FetchRequest, key: string): Promise<FetchResult>;
}
