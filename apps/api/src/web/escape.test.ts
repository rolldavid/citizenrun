import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.ts';

describe('escapeHtml', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml(`</script><script>"'&`)).toBe(
      '&lt;/script&gt;&lt;script&gt;&quot;&#39;&amp;',
    );
  });

  it('plain text is unchanged', () => {
    expect(escapeHtml('Fixture County Treasurer 2027')).toBe('Fixture County Treasurer 2027');
    expect(escapeHtml('')).toBe('');
  });

  it('escapes every occurrence and leaves an existing entity escaped once more', () => {
    expect(escapeHtml('a<b<c&amp;')).toBe('a&lt;b&lt;c&amp;amp;');
  });
});
