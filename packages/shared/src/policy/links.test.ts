import { describe, expect, it } from 'vitest';
import { SAFE_URL_MAX, SOURCE_URL_MAX, parseSafeUrl } from './links.ts';

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
