// The one place in the pipeline that calls the global fetch (D-451, PIPE-fetch). Everything above
// it goes through the fetcher, which applies the crawl policy before a request reaches here.

export type TransportRequest = {
  url: string;
  method: 'GET' | 'HEAD' | 'POST';
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
  signal: AbortSignal;
};

export type TransportResponse = {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array> | null;
};

export interface Transport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

/** Node's built-in fetch. Redirects are never followed here: the fetcher checks every hop. */
export const nodeTransport: Transport = {
  async send(req) {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      redirect: 'manual',
      signal: req.signal,
      ...(req.body === undefined ? {} : { body: req.body }),
    });
    return { status: response.status, headers: response.headers, body: response.body };
  },
};
