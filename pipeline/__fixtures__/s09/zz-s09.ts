// Helpers for the stage 9 tests: a scripted fetcher over any bucket that records every request, a
// run context, a tar.gz builder, the ZZ template output and ZZ office refs.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { DataBucket } from '../../lib/bucket.ts';
import type { FetchRequest, FetchResult, Fetcher } from '../../lib/fetch/types.ts';
import type { RunContext } from '../../lib/runner.ts';
import { OfficeRefRowSchema } from '../../stages/shared/office-ref.ts';
import type { OfficeRefRow } from '../../stages/shared/office-ref.ts';
import { loadReferenceIds } from '../../stages/shared/reference.ts';
import { repoRoot } from '../../stages/shared/repo.ts';
import { TemplateOutputSchema } from '../../templates/output.ts';
import type { TemplateOutput } from '../../templates/output.ts';
import { validateTemplateText } from '../../templates/validate.ts';
import { fixtureContext } from '../../templates/__fixtures__/zz-fake-fetcher.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import { readSavedSample } from '../../testing/saved-sample.ts';

export const S09_FIXTURES = import.meta.dirname;

/** A hand-written `zz-` fixture's text. */
export function zzText(name: string): Promise<string> {
  return readFile(join(S09_FIXTURES, name), 'utf8');
}

/** A saved sample's bytes and sidecar, checked against each other. */
export function saved(rel: string): ReturnType<typeof readSavedSample> {
  return readSavedSample(join(S09_FIXTURES, rel));
}

export type Answer =
  | { readonly body: Uint8Array | string; readonly contentType: string; readonly status?: number }
  | Exclude<FetchResult, { kind: 'ok' }>;

export type Recorded = { readonly mode: 'fetch' | 'download'; readonly req: FetchRequest };

export type ScriptFetcher = Fetcher & { readonly requests: Recorded[] };

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/json': 'json',
  'application/sparql-results+json': 'json',
  'image/jpeg': 'jpg',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

/** Answers from `script`; an unscripted URL is a 404. `ok` bodies land where the real fetcher puts them. */
export function scriptFetcher(
  bucket: DataBucket,
  script: (req: FetchRequest) => Answer | undefined,
): ScriptFetcher {
  const requests: Recorded[] = [];
  const answer = async (req: FetchRequest, key: string | null): Promise<FetchResult> => {
    const scripted = script(req) ?? { kind: 'error', status: 404, reason: 'http_status' };
    if (!('body' in scripted)) {
      return scripted;
    }
    const bytes =
      typeof scripted.body === 'string' ? new TextEncoder().encode(scripted.body) : scripted.body;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const media = scripted.contentType.split(';')[0]?.trim() ?? '';
    const target = key ?? `cache/raw/${sha256}.${EXTENSIONS[media] ?? 'bin'}`;
    await bucket.putBytes(target, bytes, scripted.contentType);
    return {
      kind: 'ok',
      finalUrl: req.url,
      status: scripted.status ?? 200,
      contentType: scripted.contentType,
      etag: null,
      lastModified: null,
      sha256,
      bytes: bytes.byteLength,
      cacheKey: target,
    };
  };
  return {
    requests,
    fetch(req) {
      requests.push({ mode: 'fetch', req });
      return answer(req, null);
    },
    download(req, key) {
      requests.push({ mode: 'download', req });
      return answer(req, key);
    },
  };
}

/** A run context at 2026-11-26 over `bucket` and `fetcher`. */
export function s09Context(
  bucket: DataBucket,
  fetcher: Fetcher,
  opts: { runId?: string; now?: string } = {},
): RunContext {
  return fixtureContext({
    bucket,
    fetcher,
    now: new Date(opts.now ?? '2026-11-26T15:00:00.000Z'),
    runId: opts.runId ?? 'zz-s09-run',
  });
}

// --- tar.gz ---

const BLOCK = 512;

function octalField(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function tarHeader(name: string, size: number, type: string, prefix = ''): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(octalField(0o644, 8), 100);
  block.write(octalField(0, 8), 108);
  block.write(octalField(0, 8), 116);
  block.write(octalField(size, 12), 124);
  block.write(octalField(0, 12), 136);
  block.fill(0x20, 148, 156);
  block.write(type, 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  block.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function padTo(data: Buffer): Buffer {
  const rest = data.length % BLOCK;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - rest)]);
}

/** One pax record: `<length> key=value\n`, the length counting itself. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) {
    length = String(length).length + Buffer.byteLength(body);
  }
  return `${String(length)}${body}`;
}

export type TarFile = {
  readonly path: string;
  readonly body: Uint8Array | string;
  /** How the path is written: the header name (default), a pax `path` record, or a GNU long name. */
  readonly pathBy?: 'header' | 'pax' | 'gnu' | 'prefix';
};

/** A gzip tar of `files` with an optional pax global header `comment`, ended by two zero blocks. */
export function buildTarGz(files: readonly TarFile[], opts: { comment?: string } = {}): Uint8Array {
  const parts: Buffer[] = [];
  if (opts.comment !== undefined) {
    const data = Buffer.from(paxRecord('comment', opts.comment));
    parts.push(tarHeader('pax_global_header', data.length, 'g'), padTo(data));
  }
  const root = files[0]?.path.split('/')[0] ?? 'root';
  parts.push(tarHeader(`${root}/`, 0, '5'));
  for (const file of files) {
    const body = Buffer.from(typeof file.body === 'string' ? file.body : file.body);
    switch (file.pathBy ?? 'header') {
      case 'pax': {
        const data = Buffer.from(paxRecord('path', file.path));
        parts.push(tarHeader('PaxHeader', data.length, 'x'), padTo(data));
        parts.push(tarHeader('truncated-name', body.length, '0'));
        break;
      }
      case 'gnu': {
        const data = Buffer.from(`${file.path}\0`);
        parts.push(tarHeader('././@LongLink', data.length, 'L'), padTo(data));
        parts.push(tarHeader('truncated-name', body.length, '0'));
        break;
      }
      case 'prefix': {
        const cut = file.path.lastIndexOf('/');
        parts.push(tarHeader(file.path.slice(cut + 1), body.length, '0', file.path.slice(0, cut)));
        break;
      }
      case 'header':
        parts.push(tarHeader(file.path, body.length, '0'));
        break;
    }
    parts.push(padTo(body));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

// --- the ZZ template and its office refs ---

/** The stage 3 output of `zz-template.yaml`, validated with the ZZ rules module. */
export async function zzTemplateOutput(): Promise<TemplateOutput> {
  const text = await readFile(
    join(repoRoot(), 'pipeline', 'templates', '__fixtures__', 'zz-template.yaml'),
    'utf8',
  );
  const reference = await loadReferenceIds(repoRoot());
  const validated = validateTemplateText(text, {
    state: 'ZZ',
    officeTypeIds: reference.officeTypeIds,
    powerIds: reference.powerIds,
    rules: ZZ_RULES,
    isFixture: true,
  });
  if (!validated.ok) {
    throw new Error('the ZZ fixture template does not validate');
  }
  return TemplateOutputSchema.parse({
    schema_version: 1,
    state: 'ZZ',
    template: validated.template,
    grounded: {},
    checked_at: '2026-11-26T15:00:00.000Z',
  });
}

/** A stage 4 office ref of a ZZ statewide entry. */
export function zzStatewideRef(
  templateKey: string,
  officeType: string,
  seats = 1,
): OfficeRefRow {
  return OfficeRefRowSchema.parse({
    slug: `zz-${templateKey}`,
    identity: `state:ZZ|${templateKey}|state:ZZ`,
    origin: 's04-expand',
    template_key: templateKey,
    office_type_id: officeType,
    jurisdiction_key: 'state:ZZ',
    jurisdiction_kind: 'state',
    district_key: 'state:ZZ',
    county_geoid: null,
    party: null,
    party_selection: null,
    partisan: true,
    schedule: 'zz_state_general',
    track_set: 'zz_partisan',
    stagger: [],
    stagger_group: null,
    seats,
    body_size: null,
    term_years: 4,
    pay_annual_cents: null,
    pay_range: null,
    template_seats: seats,
    population: null,
  });
}

/** A ZZ executive file in the openstates/people layout, with no contact keys. */
export function zzExecutiveYaml(opts: {
  id: string;
  name: string;
  given: string;
  family: string;
  role: string;
  start: string;
  end?: string;
}): string {
  return [
    `id: ocd-person/${opts.id}`,
    `name: ${opts.name}`,
    `given_name: ${opts.given}`,
    `family_name: ${opts.family}`,
    'party:',
    '  - name: Democratic',
    'roles:',
    `  - start_date: '${opts.start}'`,
    ...(opts.end === undefined ? [] : [`    end_date: '${opts.end}'`]),
    `    type: ${opts.role}`,
    '    jurisdiction: ocd-jurisdiction/country:us/state:zz/government',
    'links:',
    `  - url: https://en.wikipedia.org/wiki/${opts.name.replace(/ /g, '_')}`,
    'sources:',
    '  - url: https://example.test/zz/governor',
    '',
  ].join('\n');
}
