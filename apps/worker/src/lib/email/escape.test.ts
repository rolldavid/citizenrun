import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.ts';

describe('escapeHtml', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml(`</script><script>"'&`)).toBe(
      '&lt;/script&gt;&lt;script&gt;&quot;&#39;&amp;',
    );
  });

  it('escapes an ampersand once', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves plain text alone', () => {
    expect(escapeHtml('Job 42 on backup.check failed three times.')).toBe(
      'Job 42 on backup.check failed three times.',
    );
  });
});
