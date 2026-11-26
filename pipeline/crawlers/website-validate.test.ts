import { describe, expect, it } from 'vitest';
import { scriptedRun } from '../sources/dataset.fixtures.ts';
import type { Answer } from '../sources/dataset.fixtures.ts';
import { validateWebsite, websiteOutcome } from './website-validate.ts';

const PAGE = '<!doctype html><title>Town hall</title>';

function run(answer: Answer | undefined) {
  return scriptedRun(() => answer);
}

describe('validateWebsite', () => {
  it('a 200 HTML page on https is valid and stored as origin plus path', async () => {
    const { fetcher } = run({ kind: 'body', contentType: 'text/html; charset=utf-8', body: PAGE });
    await expect(
      validateWebsite(fetcher, 'https://www.example.gov/home/index.html?utm=1#top', 'NC'),
    ).resolves.toEqual({ kind: 'valid', website: 'https://www.example.gov/home/index.html' });
    expect(fetcher.requests[0]?.req).toMatchObject({ class: 'crawl', state: 'NC' });
  });

  it('an http-only site is invalid', async () => {
    const { fetcher } = run({ kind: 'disallowed', reason: 'not_https' });
    await expect(validateWebsite(fetcher, 'http://www.example.gov', 'NC')).resolves.toEqual({
      kind: 'invalid',
    });
  });

  it('a 404 is invalid', async () => {
    const { fetcher } = run({ kind: 'error', status: 404, reason: 'http_status' });
    await expect(validateWebsite(fetcher, 'https://www.example.gov', 'NC')).resolves.toEqual({
      kind: 'invalid',
    });
  });

  it('a 200 that is not 200 exactly, or a network error, is invalid', async () => {
    const accepted = run({ kind: 'body', status: 203, contentType: 'text/html', body: PAGE });
    await expect(
      validateWebsite(accepted.fetcher, 'https://www.example.gov', 'NC'),
    ).resolves.toEqual({ kind: 'invalid' });
    const down = run({ kind: 'error', status: null, reason: 'network' });
    await expect(validateWebsite(down.fetcher, 'https://www.example.gov', 'NC')).resolves.toEqual({
      kind: 'invalid',
    });
  });

  it('a PDF is invalid', async () => {
    const { fetcher } = run({
      kind: 'body',
      contentType: 'application/pdf',
      body: new Uint8Array([37, 80, 68, 70]),
    });
    await expect(validateWebsite(fetcher, 'https://www.example.gov/a.pdf', 'NC')).resolves.toEqual({
      kind: 'invalid',
    });
  });

  it('business hours leave it unchecked and keep the last value', async () => {
    const { fetcher } = run({ kind: 'disallowed', reason: 'business_hours' });
    const verdict = await validateWebsite(fetcher, 'https://www.example.gov', 'NC');
    expect(verdict).toEqual({ kind: 'unchecked', reason: 'business_hours' });
    expect(websiteOutcome(verdict, 'https://www.example.gov/')).toEqual({
      website: 'https://www.example.gov/',
      counter: 'website_unchecked',
      kept: true,
    });
    expect(websiteOutcome(verdict, null)).toEqual({
      website: null,
      counter: 'website_unchecked',
      kept: false,
    });
  });

  it('a robots refusal or a challenge leaves it unchecked', async () => {
    const robots = run({ kind: 'disallowed', reason: 'robots' });
    await expect(validateWebsite(robots.fetcher, 'https://www.example.gov', 'NC')).resolves.toEqual(
      { kind: 'unchecked', reason: 'robots' },
    );
    const challenge = run({ kind: 'challenge', status: 403 });
    await expect(
      validateWebsite(challenge.fetcher, 'https://www.example.gov', 'NC'),
    ).resolves.toEqual({ kind: 'unchecked', reason: 'challenge' });
  });

  it('a bare host gets https', async () => {
    const { fetcher } = run({ kind: 'body', contentType: 'text/html', body: PAGE });
    await expect(validateWebsite(fetcher, 'www.example.gov', 'WA')).resolves.toEqual({
      kind: 'valid',
      website: 'https://www.example.gov/',
    });
    expect(fetcher.requests.map((request) => request.url)).toEqual(['https://www.example.gov/']);
  });

  it('an address that is not a web address is invalid without a request', async () => {
    const { fetcher } = run(undefined);
    await expect(validateWebsite(fetcher, 'N/A see clerk', 'NC')).resolves.toEqual({
      kind: 'invalid',
    });
    await expect(validateWebsite(fetcher, 'mailto:clerk@example.gov', 'NC')).resolves.toEqual({
      kind: 'invalid',
    });
    expect(fetcher.requests).toEqual([]);
  });

  it('an invalid verdict writes null', () => {
    expect(websiteOutcome({ kind: 'invalid' }, 'https://www.example.gov/')).toEqual({
      website: null,
      counter: 'website_invalid',
      kept: false,
    });
  });
});
