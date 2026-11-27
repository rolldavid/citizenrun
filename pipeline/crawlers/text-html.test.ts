import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'cheerio';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractHtmlText } from './text-html.ts';

// A hand-written statute section page in the ZZ fixture world (D-876).
const FIXTURES = join(import.meta.dirname, '..', '__fixtures__', 's03');
const QUOTE = 'beginning the first Monday in May and ending the following Friday';

let page: string;

beforeAll(async () => {
  page = await readFile(join(FIXTURES, 'zz-statute-section.html'), 'utf8');
});

/** The text of every element of the page matching `selector`, whitespace collapsed. */
function textsOf(html: string, selector: string): string[] {
  const $ = load(html);
  return $(selector)
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '');
}

describe('extractHtmlText', () => {
  it('the fixture statute page gives the section text and no navigation, script or form', () => {
    const text = extractHtmlText(page);
    expect(text.replace(/\s+/g, ' ')).toContain(QUOTE);
    expect(text).toContain('ZZ Fixture Code 24.050');
    expect(text).toContain('Fixture county office | Fixture county auditor');
    for (const outside of ['Fixture search', 'Fixture footer', 'Fixture hidden note']) {
      expect(text).not.toContain(outside);
    }
    const scripts = textsOf(page, 'script').filter((script) => script.length >= 20);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(text).not.toContain(script.slice(0, 40));
    }
    const navs = textsOf(page, 'nav, [role=navigation]');
    expect(navs.length).toBe(2);
    for (const nav of navs) {
      expect(text.replace(/\s+/g, ' ')).not.toContain(nav);
    }
    expect(text.split('\n').every((line) => line.trim() !== '' && line === line.trim())).toBe(true);
    expect(text).toBe(text.normalize('NFC'));
  });

  it('joins the cells of a table row with a bar', () => {
    expect(extractHtmlText('<table><tr><td>a</td><td>b</td></tr></table>')).toBe('a | b');
  });

  it('puts a line break after each block and drops empty lines', () => {
    const html =
      '<body><header>Site</header><main><h1>Title</h1><p>One   two</p><div></div><p>three<br>four</p><ul><li>five</li></ul></main><footer>Foot</footer></body>';
    expect(extractHtmlText(html)).toBe('Title\nOne two\nthree\nfour\nfive');
  });

  it('takes the article when there is no main, and skips hidden and form text', () => {
    const html =
      '<body><nav>Menu</nav><article><p>Kept</p><span aria-hidden="true">Hidden</span><form>Search</form></article><p>Outside</p></body>';
    expect(extractHtmlText(html)).toBe('Kept');
  });

  it('a malformed fragment still returns its text', () => {
    expect(extractHtmlText('<p>unclosed')).toBe('unclosed');
  });

  it('applies NFC', () => {
    expect(extractHtmlText('<p>Cafe\u0301</p>')).toBe('Caf\u00e9');
  });
});
