import { describe, expect, it } from 'vitest';
import { escapeHtml, isSafeHref, jsonForScript } from './escape.ts';

describe('escapeHtml', () => {
  it('escapes the five characters in text and attributes', () => {
    expect(escapeHtml(`</script><script>"'&`)).toBe(
      '&lt;/script&gt;&lt;script&gt;&quot;&#39;&amp;',
    );
    // In an attribute value the quotes can no longer end the attribute.
    const attribute = `<a title="${escapeHtml(`x" onclick="alert(1)' y`)}">`;
    expect(attribute).toBe('<a title="x&quot; onclick=&quot;alert(1)&#39; y">');
  });

  it('a hostile name renders as text', () => {
    const html = `<p>${escapeHtml('</script><script>alert(1)</script>')}</p>`;
    expect(html).not.toContain('<script');
    expect(html).toBe('<p>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('plain text is unchanged', () => {
    expect(escapeHtml('Fixture County Treasurer 2027')).toBe('Fixture County Treasurer 2027');
    expect(escapeHtml('')).toBe('');
  });

  it('escapes every occurrence and leaves an existing entity escaped once more', () => {
    expect(escapeHtml('a<b<c&amp;')).toBe('a&lt;b&lt;c&amp;amp;');
  });

  it('each character alone', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });
});

describe('jsonForScript', () => {
  it('jsonForScript escapes angle brackets, ampersands and the two line separators', () => {
    const output = jsonForScript({ a: '</script>', b: '&', c: '\u2028', d: '\u2029' });
    expect(output).toBe('{"a":"\\u003c/script\\u003e","b":"\\u0026","c":"\\u2028","d":"\\u2029"}');
    for (const raw of ['<', '>', '&', '\u2028', '\u2029']) {
      expect(output.includes(raw), JSON.stringify(raw)).toBe(false);
    }
    // ASCII only, and the value reads back unchanged.
    expect(/^[\x20-\x7e]*$/.test(output)).toBe(true);
    expect(JSON.parse(output)).toEqual({ a: '</script>', b: '&', c: '\u2028', d: '\u2029' });
  });

  it('a value with none of the five characters is plain JSON', () => {
    expect(jsonForScript({ n: 1, s: 'x', l: [true, null] })).toBe(
      '{"n":1,"s":"x","l":[true,null]}',
    );
  });
});

describe('isSafeHref', () => {
  it('isSafeHref accepts a path and an https URL of 2048 characters', () => {
    expect(isSafeHref('/privacy')).toBe(true);
    expect(isSafeHref('/')).toBe(true);
    const base = 'https://example.test/';
    const url = base + 'a'.repeat(2048 - base.length);
    expect(url).toHaveLength(2048);
    expect(isSafeHref(url)).toBe(true);
  });

  it('refuses //host, /\\host, http:, javascript: and a 2049-character URL', () => {
    expect(isSafeHref('//example.test/x')).toBe(false);
    expect(isSafeHref('/\\example.test/x')).toBe(false);
    expect(isSafeHref('http://example.test/x')).toBe(false);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    const base = 'https://example.test/';
    expect(isSafeHref(base + 'a'.repeat(2049 - base.length))).toBe(false);
    expect(isSafeHref('')).toBe(false);
    expect(isSafeHref('mailto:someone@example.test')).toBe(false);
  });
});
