import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractHtmlText } from '../crawlers/text-html.ts';
import { isQuoteGrounded, textKeys } from '../extract/grounding.ts';
import { readSavedSample } from '../testing/saved-sample.ts';
import { HOUSE_TERM, SENATE_TERM } from './federal.ts';
import { KNOWN_FIXTURES } from './s02-known.fixtures.ts';

async function pageText(name: string): Promise<{ text: string; url: string }> {
  const { bytes, meta } = await readSavedSample(join(KNOWN_FIXTURES, name));
  return { text: extractHtmlText(new TextDecoder('utf-8').decode(bytes)), url: meta.url };
}

describe('the federal term constants', () => {
  it.each([
    ['constitution-transcript.html', HOUSE_TERM],
    ['amendments-11-27.html', SENATE_TERM],
  ] as const)('the saved page %s holds its quote as the page writes it', async (name, term) => {
    const { text, url } = await pageText(name);
    expect(url).toBe(term.source_url);
    expect(text.replace(/\s+/g, ' ')).toContain(term.quote);
    expect(isQuoteGrounded(term.quote, textKeys(text))).toBe(true);
  });

  it('a quote of one page is not on the other', async () => {
    const { text } = await pageText('amendments-11-27.html');
    expect(isQuoteGrounded(HOUSE_TERM.quote, textKeys(text))).toBe(false);
  });
});
