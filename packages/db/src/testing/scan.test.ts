import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { scanPatterns, scanTexts } from './scan.ts';

describe('scanTexts', () => {
  it('finds the marker and names only the source', () => {
    const m = marker();
    const found = scanTexts([{ source: 'log line 3', text: `x ${m} y` }], scanPatterns(m, []));
    expect(found).toEqual([{ source: 'log line 3', pattern: 'marker' }]);
    expect(JSON.stringify(found)).not.toContain(m);
  });

  it('finds every fixed pattern', () => {
    const texts = [
      { source: 'a', text: 'sent to a@example.test' },
      { source: 'b', text: 'https://store/key?X-Amz-Signature=abc' },
      { source: 'c', text: 'authorization: Bearer abc' },
      { source: 'd', text: 'cookie: os_session=abc' },
    ];
    expect(scanTexts(texts, scanPatterns(marker(), []))).toEqual([
      { source: 'a', pattern: 'email' },
      { source: 'b', pattern: 'presigned-url' },
      { source: 'c', pattern: 'bearer' },
      { source: 'd', pattern: 'session-cookie' },
    ]);
  });

  it('finds the base64 form of the marker inside a longer encoded text', () => {
    const m = marker();
    const encoded = Buffer.from(`${m} and more`).toString('base64');
    expect(scanTexts([{ source: 'job 1', text: encoded }], scanPatterns(m, []))).toEqual([
      { source: 'job 1', pattern: 'marker-base64' },
    ]);
  });

  it('finds a registered value', () => {
    const found = scanTexts(
      [{ source: 'log line 1', text: 'token tok_fixture_123 issued' }],
      scanPatterns(marker(), ['tok_fixture_123']),
    );
    expect(found).toEqual([{ source: 'log line 1', pattern: 'registered-1' }]);
  });

  it('passes clean text', () => {
    expect(
      scanTexts(
        [{ source: 'log line 1', text: '{"event":"request.done","status":200}' }],
        scanPatterns(marker(), []),
      ),
    ).toEqual([]);
  });
});
