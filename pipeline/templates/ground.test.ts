import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractHtmlText } from '../crawlers/text-html.ts';
import { textSha256 } from '../crawlers/text-store.ts';
import { bucketKeys } from '../lib/bucket.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import { fakeFetcher, fixtureContext } from './__fixtures__/zz-fake-fetcher.ts';
import type { FakeAnswer } from './__fixtures__/zz-fake-fetcher.ts';
import { groundCited } from './ground.ts';
import type { GroundItem, PreviousMarks } from './ground.ts';

// Hand-written statute section fixtures in the ZZ world, an HTML page and its PDF form (D-876).
const FIXTURES = join(import.meta.dirname, '..', '__fixtures__', 's03');
const CODE_URL = 'https://example.test/zz/code?cite=24.050';
const CODE_QUOTE = 'beginning the first Monday in May and ending the following Friday';
const NOW = new Date('2026-11-21T20:00:00.000Z');

// A one-page PDF with no text on it.
const BLANK_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`;

let html: Uint8Array;
let pdf: Uint8Array;

beforeAll(async () => {
  html = new Uint8Array(await readFile(join(FIXTURES, 'zz-statute-section.html')));
  pdf = new Uint8Array(await readFile(join(FIXTURES, 'zz-statute-section.pdf')));
});

function item(path: string, quote: string, url = CODE_URL): GroundItem {
  return { path, node: { source_url: url, quote, citation: 'ZZ Fixture Code 24.050' } };
}

function setup(answers: Readonly<Record<string, FakeAnswer>>) {
  const bucket = createMemoryBucket();
  const fetcher = fakeFetcher(bucket, answers);
  return { bucket, fetcher, ctx: fixtureContext({ bucket, fetcher, now: NOW }) };
}

const htmlPage = (): Record<string, FakeAnswer> => ({
  [CODE_URL]: { body: html, contentType: 'text/html; charset=utf-8' },
});

const earlier: PreviousMarks = {
  'a.quote': {
    grounded: true,
    checked_at: '2026-06-01T00:00:00.000Z',
    text_sha256: 'b'.repeat(64),
    reason: 'grounded',
    source_url: CODE_URL,
    quote: CODE_QUOTE,
  },
};

describe('groundCited', () => {
  it('a statute page grounds the filing-week quote', async () => {
    const { ctx, bucket } = setup(htmlPage());
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE)], { state: 'ZZ', previous: null });
    const sha = textSha256(extractHtmlText(new TextDecoder().decode(html)));
    expect(marks).toEqual({
      a: {
        grounded: true,
        checked_at: '2026-11-21T20:00:00.000Z',
        text_sha256: sha,
        reason: 'grounded',
      },
    });
    const stored = await bucket.getBytes(bucketKeys.textCache(sha));
    expect(stored === null ? null : textSha256(gunzipSync(stored).toString('utf8'))).toBe(sha);
  });

  it('a quote the page does not contain is not grounded', async () => {
    const { ctx } = setup(htmlPage());
    const marks = await groundCited(
      ctx,
      [item('a', 'beginning the first Tuesday in June and ending the following Friday')],
      {
        state: 'ZZ',
        previous: null,
      },
    );
    expect(marks['a']).toMatchObject({
      grounded: false,
      reason: 'not_found',
      checked_at: '2026-11-21T20:00:00.000Z',
    });
  });

  it('a refused fetch carries an earlier grounding', async () => {
    const { ctx } = setup({ [CODE_URL]: { kind: 'disallowed', reason: 'business_hours' } });
    const marks = await groundCited(ctx, [item('a.quote', CODE_QUOTE)], {
      state: 'ZZ',
      previous: earlier,
    });
    expect(marks).toEqual({
      'a.quote': {
        grounded: true,
        checked_at: '2026-06-01T00:00:00.000Z',
        text_sha256: 'b'.repeat(64),
        reason: 'carried',
      },
    });
  });

  it('an earlier grounding of another quote is not carried', async () => {
    const { ctx } = setup({ [CODE_URL]: { kind: 'challenge', status: 403 } });
    const marks = await groundCited(ctx, [item('a.quote', 'ending the following Friday')], {
      state: 'ZZ',
      previous: earlier,
    });
    expect(marks['a.quote']).toEqual({
      grounded: false,
      checked_at: null,
      text_sha256: null,
      reason: 'challenge',
    });
  });

  it('a refused fetch with no earlier grounding is ungrounded', async () => {
    const { ctx } = setup({ [CODE_URL]: { kind: 'disallowed', reason: 'business_hours' } });
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE)], { state: 'ZZ', previous: null });
    expect(marks['a']).toEqual({
      grounded: false,
      checked_at: null,
      text_sha256: null,
      reason: 'refused',
    });
  });

  it('maps not_https and fetch errors to their reasons', async () => {
    const other = 'https://example.test/zz/other';
    const { ctx } = setup({
      [CODE_URL]: { kind: 'disallowed', reason: 'not_https' },
      [other]: { kind: 'error', status: 500, reason: 'http_status' },
    });
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE), item('b', CODE_QUOTE, other)], {
      state: null,
      previous: null,
    });
    expect([marks['a']?.reason, marks['b']?.reason]).toEqual(['not_https', 'fetch_error']);
  });

  it('one request per URL', async () => {
    const { ctx, fetcher } = setup(htmlPage());
    const marks = await groundCited(
      ctx,
      [item('a', CODE_QUOTE), item('b', 'the following Friday'), item('c', 'no such text')],
      {
        state: 'ZZ',
        previous: null,
      },
    );
    expect(fetcher.requests).toEqual([
      { url: CODE_URL, class: 'crawl', method: 'GET', state: 'ZZ' },
    ]);
    expect([marks['a']?.reason, marks['b']?.reason, marks['c']?.reason]).toEqual([
      'grounded',
      'grounded',
      'not_found',
    ]);
  });

  it('the PDF form of the section grounds the quote', async () => {
    const { ctx } = setup({ [CODE_URL]: { body: pdf, contentType: 'application/pdf' } });
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE)], { state: 'ZZ', previous: null });
    expect(marks['a']).toMatchObject({ grounded: true, reason: 'grounded' });
  });

  it('a PDF without a text layer leaves its quotes ungrounded', async () => {
    const { ctx } = setup({ [CODE_URL]: { body: BLANK_PDF, contentType: 'application/pdf' } });
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE)], { state: 'ZZ', previous: null });
    expect(marks['a']).toEqual({
      grounded: false,
      checked_at: null,
      text_sha256: null,
      reason: 'no_text_layer',
    });
  });

  it('an unreadable PDF and an unsupported type leave their quotes ungrounded', async () => {
    const other = 'https://example.test/zz/sheet';
    const { ctx } = setup({
      [CODE_URL]: {
        body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        contentType: 'application/pdf',
      },
      [other]: { body: 'a,b\n', contentType: 'text/csv' },
    });
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE), item('b', CODE_QUOTE, other)], {
      state: 'ZZ',
      previous: null,
    });
    expect([marks['a']?.reason, marks['b']?.reason]).toEqual([
      'pdf_unreadable',
      'unsupported_type',
    ]);
  });

  it('logs one line per URL with the host, result and quote count, never a quote', async () => {
    const bucket = createMemoryBucket();
    const { log, lines } = captureLogger();
    const ctx = fixtureContext({ bucket, fetcher: fakeFetcher(bucket, htmlPage()), now: NOW, log });
    await groundCited(ctx, [item('a', CODE_QUOTE), item('b', 'the following Friday')], {
      state: 'ZZ',
      previous: null,
    });
    const ground = lines.filter((line) => line.parsed['event'] === 'templates.ground');
    expect(
      ground.map((line) => [line.parsed['host'], line.parsed['result'], line.parsed['quotes']]),
    ).toEqual([['example.test', 'ok', 2]]);
    expect(lines.some((line) => line.raw.includes('Friday') || line.raw.includes('cite='))).toBe(
      false,
    );
  });

  it('a plain-text page is read as UTF-8', async () => {
    const { ctx } = setup({
      [CODE_URL]: { body: `Filing: ${CODE_QUOTE}.`, contentType: 'text/plain' },
    });
    const marks = await groundCited(ctx, [item('a', CODE_QUOTE)], { state: 'ZZ', previous: null });
    expect(marks['a']?.reason).toBe('grounded');
  });
});
