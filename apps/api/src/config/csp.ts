import { createHash } from 'node:crypto';
import { DOCUMENT_PAGE_CSS } from '@citizenrun/shared';
import type { ApiEnv } from '../env.ts';

/** Whether the shell's policy is enforced; report-only until then (D-232). */
export const CSP_ENFORCED: boolean = false; // D-232

/** The policy of every `/v1` response (L-security-headers, D-446). */
export const V1_CSP = "default-src 'none'; frame-ancestors 'none'"; // L-security-headers, D-446

/** A CSP hash source: `'sha256-` + base64 of the SHA-256 of the UTF-8 text + `'`. */
export function sha256Source(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** Hashes of the server's own page stylesheets and scripts, computed once at start (L-csp). */
export const pageHashes: {
  readonly styles: readonly string[];
  readonly scripts: readonly string[];
} = Object.freeze({
  styles: Object.freeze([sha256Source(DOCUMENT_PAGE_CSS)]),
  scripts: Object.freeze([]),
});

/** What the shell's policy is built from, computed once at start (L-csp). */
export type CspInputs = {
  mediaOrigin: string;
  wsOrigin: string;
  tilesOrigin: string | null;
  glyphsOrigin: string | null;
  scriptHashes: readonly string[];
  styleHashes: readonly string[];
  upgradeInsecureRequests: boolean;
};

const GOOGLE_GSI = 'https://accounts.google.com/gsi/';
const GOOGLE_GSI_CLIENT = 'https://accounts.google.com/gsi/client';
const GOOGLE_GSI_STYLE = 'https://accounts.google.com/gsi/style';
const APPLE_JS = 'https://appleid.cdn-apple.com';

/** The media bucket's origin: virtual-hosted unless path style is forced (D-248). */
export function mediaOrigin(env: ApiEnv): string {
  const endpoint = new URL(env.MEDIA_ENDPOINT);
  return env.S3_FORCE_PATH_STYLE ? endpoint.origin : `https://${env.MEDIA_BUCKET}.${endpoint.host}`;
}

/** `PUBLIC_URL` with its scheme swapped for the socket's. */
export function wsOrigin(publicUrl: string): string {
  if (publicUrl.startsWith('https:')) {
    return `wss:${publicUrl.slice('https:'.length)}`;
  }
  if (publicUrl.startsWith('http:')) {
    return `ws:${publicUrl.slice('http:'.length)}`;
  }
  return publicUrl;
}

/** The inputs of the shell's policy, from the environment and the shell's inline hashes. */
export function cspInputs(
  env: ApiEnv,
  shell: { scriptHashes: readonly string[]; styleHashes: readonly string[] },
): CspInputs {
  return {
    mediaOrigin: mediaOrigin(env),
    wsOrigin: wsOrigin(env.PUBLIC_URL),
    tilesOrigin: null,
    glyphsOrigin: null,
    scriptHashes: [...shell.scriptHashes],
    styleHashes: [...shell.styleHashes],
    upgradeInsecureRequests: new URL(env.PUBLIC_URL).protocol === 'https:',
  };
}

/** The shell's policy, its directives in the table's order (L-csp). */
export function buildShellCsp(inputs: CspInputs): string {
  const connect = ["'self'", inputs.wsOrigin, inputs.mediaOrigin];
  if (inputs.tilesOrigin !== null) {
    connect.push(inputs.tilesOrigin);
  }
  if (inputs.glyphsOrigin !== null) {
    connect.push(inputs.glyphsOrigin);
  }
  connect.push(GOOGLE_GSI);
  const directives: (readonly string[])[] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      APPLE_JS,
      GOOGLE_GSI_CLIENT,
      ...inputs.scriptHashes,
      ...pageHashes.scripts,
    ],
    ['style-src', "'self'", GOOGLE_GSI_STYLE, ...inputs.styleHashes, ...pageHashes.styles],
    ['img-src', "'self'", 'data:', 'blob:', inputs.mediaOrigin],
    ['media-src', "'self'", 'blob:', inputs.mediaOrigin],
    ['font-src', "'self'", 'data:'],
    ['connect-src', ...connect],
    ['frame-src', GOOGLE_GSI],
    ['worker-src', "'self'", 'blob:'],
    ['child-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  if (inputs.upgradeInsecureRequests) {
    directives.push(['upgrade-insecure-requests']);
  }
  return directives.map((parts) => parts.join(' ')).join('; ');
}

/** The header the shell's policy is sent in: report-only while it is not enforced. */
export function shellCspHeaderName():
  'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return CSP_ENFORCED ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}
