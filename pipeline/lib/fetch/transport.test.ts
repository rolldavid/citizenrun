import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeTransport } from './transport.ts';

// A server on the loopback interface stands in for a host; the transport does not care about
// the scheme, and nothing here leaves the machine.
const server = createServer((req, res) => {
  if (req.url === '/moved') {
    res.writeHead(302, { location: '/target' });
    res.end('moved');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain', 'x-seen-agent': req.headers['user-agent'] });
  res.end(`${req.method ?? ''} ${req.url ?? ''}`);
});
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

async function text(body: AsyncIterable<Uint8Array> | null): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body ?? []) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('nodeTransport', () => {
  it('returns a redirect as it is, with its Location header', async () => {
    const response = await nodeTransport.send({
      url: `${base}/moved`,
      method: 'GET',
      headers: {},
      signal: new AbortController().signal,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/target');
    await text(response.body);
  });

  it('sends the method and headers and streams the body', async () => {
    const response = await nodeTransport.send({
      url: `${base}/page?x=1`,
      method: 'POST',
      headers: { 'User-Agent': 'FixtureBot/1.0' },
      body: new TextEncoder().encode('a=b'),
      signal: new AbortController().signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-seen-agent')).toBe('FixtureBot/1.0');
    expect(await text(response.body)).toBe('POST /page?x=1');
  });
});
