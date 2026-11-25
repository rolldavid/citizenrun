import { describe, expect, it } from 'vitest';
import {
  LINK_REL,
  SAFE_URL_MAX,
  SOURCE_URL_MAX,
  containsLink,
  linkify,
  parseSafeUrl,
} from './links.ts';
import type { TextSegment } from './links.ts';

function urlOfLength(length: number): string {
  const prefix = 'https://example.org/';
  return prefix + 'a'.repeat(length - prefix.length);
}

describe('parseSafeUrl', () => {
  it('accepts a 200-character https URL and refuses 201 with the default limit', () => {
    expect(SAFE_URL_MAX).toBe(200);
    const url = urlOfLength(200);
    expect(url).toHaveLength(200);
    expect(parseSafeUrl(url)).toEqual({ url, domain: 'example.org' });
    expect(parseSafeUrl(urlOfLength(201))).toBeNull();
  });

  it('accepts 201 characters with SOURCE_URL_MAX', () => {
    const url = urlOfLength(201);
    expect(parseSafeUrl(url, SOURCE_URL_MAX)).toEqual({ url, domain: 'example.org' });
  });

  it('refuses 2,049 characters with SOURCE_URL_MAX', () => {
    expect(SOURCE_URL_MAX).toBe(2048);
    expect(parseSafeUrl(urlOfLength(2048), SOURCE_URL_MAX)).not.toBeNull();
    expect(parseSafeUrl(urlOfLength(2049), SOURCE_URL_MAX)).toBeNull();
  });

  it('refuses http, javascript and data', () => {
    expect(parseSafeUrl('http://example.org')).toBeNull();
    expect(parseSafeUrl('javascript:alert(1)')).toBeNull();
    expect(parseSafeUrl('data:text/html,<b>x</b>')).toBeNull();
  });

  it('lower-cases the scheme and host and keeps the rest', () => {
    expect(parseSafeUrl('https://Example.org/donate?x=1')).toEqual({
      url: 'https://example.org/donate?x=1',
      domain: 'example.org',
    });
    expect(parseSafeUrl('  HTTPS://Example.org/A?B=C#D  ')).toEqual({
      url: 'https://example.org/A?B=C#D',
      domain: 'example.org',
    });
  });

  it('drops a leading www from the domain', () => {
    expect(parseSafeUrl('https://www.city.gov')).toEqual({
      url: 'https://www.city.gov',
      domain: 'city.gov',
    });
  });

  it('refuses credentials, IP literals and a host without a dot', () => {
    expect(parseSafeUrl('https://user:pw@example.org')).toBeNull();
    expect(parseSafeUrl('https://192.168.0.1/')).toBeNull();
    expect(parseSafeUrl('https://[2001:db8::1]/')).toBeNull();
    expect(parseSafeUrl('https://localhost')).toBeNull();
  });

  it('checks the labels, the last label and the port', () => {
    expect(parseSafeUrl('https://example.org:8443/x')).toEqual({
      url: 'https://example.org:8443/x',
      domain: 'example.org',
    });
    expect(parseSafeUrl('https://example.org:123456/')).toBeNull();
    expect(parseSafeUrl('https://-bad.example.org/')).toBeNull();
    expect(parseSafeUrl('https://bad-.example.org/')).toBeNull();
    expect(parseSafeUrl('https://ex_ample.org/')).toBeNull();
    expect(parseSafeUrl(`https://${'a'.repeat(64)}.org/`)).toBeNull();
    expect(parseSafeUrl(`https://${'a'.repeat(63)}.org/`)).not.toBeNull();
    expect(parseSafeUrl('https://example.c/')).toBeNull();
    expect(parseSafeUrl('https://example.123/')).toBeNull();
    expect(parseSafeUrl(`https://example.${'a'.repeat(25)}/`)).toBeNull();
    expect(parseSafeUrl('https://example..org/')).toBeNull();
  });

  it('refuses whitespace and control characters after the host', () => {
    expect(parseSafeUrl('https://example.org/a b')).toBeNull();
    expect(parseSafeUrl('https://example.org/a\tb')).toBeNull();
    expect(parseSafeUrl('https://example.org/a\u0007b')).toBeNull();
    expect(parseSafeUrl('https://example.org/a b')).toBeNull();
  });
});

function joined(segments: readonly TextSegment[]): string {
  return segments.map((segment) => segment.value).join('');
}

describe('linkify', () => {
  it('linkify finds https links', () => {
    const input = 'Read https://example.org/a.';
    const segments = linkify(input);
    expect(segments).toEqual([
      { type: 'text', value: 'Read ' },
      {
        type: 'link',
        value: 'https://example.org/a',
        href: 'https://example.org/a',
        domain: 'example.org',
      },
      { type: 'text', value: '.' },
    ]);
    expect(joined(segments)).toBe(input);
  });

  it('linkify leaves http links as text', () => {
    const input = 'See http://example.org/a now';
    const segments = linkify(input);
    expect(segments).toEqual([{ type: 'text', value: input }]);
    expect(joined(segments)).toBe(input);
  });

  it('linkify leaves a bare domain as text', () => {
    const input = 'bare domain stays text: example.org and www.example.org';
    const segments = linkify(input);
    expect(segments).toEqual([{ type: 'text', value: input }]);
    expect(joined(segments)).toBe(input);
  });

  it('linkify refuses a 201-character link', () => {
    const url = urlOfLength(201);
    expect(url).toHaveLength(201);
    const input = `long ${url} end`;
    const segments = linkify(input);
    expect(segments).toEqual([{ type: 'text', value: input }]);
    expect(joined(segments)).toBe(input);
  });

  it('joining the segments gives the input back', () => {
    const inputs = [
      'Read https://example.org/a.',
      'See http://example.org/a now',
      'bare domain stays text: example.org',
      `long ${urlOfLength(201)} end`,
      '',
      'https://example.org',
      '(see https://Example.org/x?y=1), then "https://www.city.gov/a"!',
      'https://a.org https://b.org',
      'https://localhost and https://example.org/ok.',
      'HTTPS://EXAMPLE.ORG/Path)]};',
      'x<https://example.org/a>y',
    ];
    for (const input of inputs) {
      expect(joined(linkify(input)), input).toBe(input);
    }
  });

  it('gives no empty segment and merges text around a refused run', () => {
    expect(linkify('')).toEqual([]);
    const segments = linkify('https://a.org https://localhost https://b.org');
    for (const segment of segments) {
      expect(segment.value).not.toBe('');
    }
    expect(segments.map((segment) => segment.type)).toEqual(['link', 'text', 'link']);
    expect(segments[1]).toEqual({ type: 'text', value: ' https://localhost ' });
  });

  it('returns the stripped punctuation to the following text', () => {
    expect(linkify('(see https://Example.org/x?y=1), then')).toEqual([
      { type: 'text', value: '(see ' },
      {
        type: 'link',
        value: 'https://Example.org/x?y=1',
        href: 'https://example.org/x?y=1',
        domain: 'example.org',
      },
      { type: 'text', value: '), then' },
    ]);
  });

  it('stops a run at angle brackets and quotes', () => {
    expect(linkify('x<https://example.org/a>y')).toEqual([
      { type: 'text', value: 'x<' },
      {
        type: 'link',
        value: 'https://example.org/a',
        href: 'https://example.org/a',
        domain: 'example.org',
      },
      { type: 'text', value: '>y' },
    ]);
  });
});

describe('LINK_REL', () => {
  it('rel attributes', () => {
    expect(LINK_REL).toBe('nofollow ugc noopener noreferrer');
  });
});

describe('containsLink', () => {
  it('is true for links and things that read as links', () => {
    for (const text of [
      'https://example.org',
      'http://example.org',
      'www.example',
      'example.org',
      'name@example.org',
    ]) {
      expect(containsLink(text), text).toBe(true);
    }
  });

  it('is false for plain text', () => {
    for (const text of ['no links here', 'e.g. this', '3.14']) {
      expect(containsLink(text), text).toBe(false);
    }
  });
});
