import { describe, expect, it } from 'vitest';
import { testApiEnv } from '../testing/env.ts';
import {
  CSP_ENFORCED,
  V1_CSP,
  buildShellCsp,
  cspInputs,
  mediaOrigin,
  pageHashes,
  sha256Source,
  shellCspHeaderName,
  wsOrigin,
} from './csp.ts';
import type { CspInputs } from './csp.ts';

const FIXTURE_INPUTS: CspInputs = {
  mediaOrigin: 'https://media-x.t3.example.test',
  wsOrigin: 'wss://app.example.test',
  tilesOrigin: null,
  glyphsOrigin: null,
  scriptHashes: ["'sha256-c2NyaXB0Zml4dHVyZQ=='"],
  styleHashes: ["'sha256-c3R5bGVmaXh0dXJl'"],
  upgradeInsecureRequests: true,
};

function directive(policy: string, name: string): string | undefined {
  return policy.split('; ').find((part) => part === name || part.startsWith(`${name} `));
}

describe('content security policy', () => {
  it('the shell policy for a fixture input is exactly this string', () => {
    expect(buildShellCsp(FIXTURE_INPUTS)).toBe(
      "default-src 'self'; " +
        "script-src 'self' https://appleid.cdn-apple.com https://accounts.google.com/gsi/client 'sha256-c2NyaXB0Zml4dHVyZQ=='; " +
        "style-src 'self' https://accounts.google.com/gsi/style 'sha256-c3R5bGVmaXh0dXJl'; " +
        "img-src 'self' data: blob: https://media-x.t3.example.test; " +
        "media-src 'self' blob: https://media-x.t3.example.test; " +
        "font-src 'self' data:; " +
        "connect-src 'self' wss://app.example.test https://media-x.t3.example.test https://accounts.google.com/gsi/; " +
        'frame-src https://accounts.google.com/gsi/; ' +
        "worker-src 'self' blob:; " +
        "child-src 'self' blob:; " +
        "manifest-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'none'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'; " +
        'upgrade-insecure-requests',
    );
    expect(pageHashes).toEqual({ styles: [], scripts: [] });
  });

  it('script-src has no unsafe-eval or unsafe-inline', () => {
    const policy = buildShellCsp(FIXTURE_INPUTS);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain('report-uri');
  });

  it('frame-ancestors and base-uri are none', () => {
    const policy = buildShellCsp(FIXTURE_INPUTS);
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(V1_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it('upgrade-insecure-requests only on https', () => {
    const https = cspInputs(testApiEnv(), { scriptHashes: [], styleHashes: [] });
    expect(https.upgradeInsecureRequests).toBe(true);
    expect(directive(buildShellCsp(https), 'upgrade-insecure-requests')).toBe(
      'upgrade-insecure-requests',
    );
    const http = cspInputs(testApiEnv({ PUBLIC_URL: 'http://localhost:8080' }), {
      scriptHashes: [],
      styleHashes: [],
    });
    expect(http.upgradeInsecureRequests).toBe(false);
    expect(directive(buildShellCsp(http), 'upgrade-insecure-requests')).toBeUndefined();
  });

  it('tile and glyph origins are left out until set', () => {
    const inputs = cspInputs(testApiEnv(), { scriptHashes: ["'sha256-x'"], styleHashes: [] });
    expect(inputs.tilesOrigin).toBeNull();
    expect(inputs.glyphsOrigin).toBeNull();
    expect(inputs.scriptHashes).toEqual(["'sha256-x'"]);
    expect(directive(buildShellCsp(inputs), 'connect-src')).toBe(
      "connect-src 'self' wss://app.example.test http://localhost:8333 https://accounts.google.com/gsi/",
    );
    const withMap = buildShellCsp({
      ...FIXTURE_INPUTS,
      tilesOrigin: 'https://tiles.example.test',
      glyphsOrigin: 'https://glyphs.example.test',
    });
    expect(directive(withMap, 'connect-src')).toBe(
      "connect-src 'self' wss://app.example.test https://media-x.t3.example.test https://tiles.example.test https://glyphs.example.test https://accounts.google.com/gsi/",
    );
  });

  it('mediaOrigin follows the addressing style', () => {
    const virtualHosted = testApiEnv({
      S3_FORCE_PATH_STYLE: 'false',
      MEDIA_BUCKET: 'media-x',
      MEDIA_ENDPOINT: 'https://t3.example.test',
    });
    expect(mediaOrigin(virtualHosted)).toBe('https://media-x.t3.example.test');
    const pathStyle = testApiEnv({
      S3_FORCE_PATH_STYLE: 'true',
      MEDIA_ENDPOINT: 'http://localhost:8333',
    });
    expect(mediaOrigin(pathStyle)).toBe('http://localhost:8333');
  });

  it('wsOrigin swaps the scheme', () => {
    expect(wsOrigin('https://app.example.test')).toBe('wss://app.example.test');
    expect(wsOrigin('http://localhost:8080')).toBe('ws://localhost:8080');
  });

  it("sha256Source of 'a' is 'sha256-ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs='", () => {
    expect(sha256Source('a')).toBe("'sha256-ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs='");
  });

  it('the header is report-only while CSP_ENFORCED is false', () => {
    expect(CSP_ENFORCED).toBe(false);
    expect(shellCspHeaderName()).toBe('Content-Security-Policy-Report-Only');
  });
});
