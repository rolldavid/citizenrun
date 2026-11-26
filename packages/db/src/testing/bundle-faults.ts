import { createHash } from 'node:crypto';
import { LOADER_SCHEMA_REVISION } from '@citizenrun/shared';
import type { FullFileR0 } from '../bundle/tables.ts';
import { fixturePhotoRecord, zzGeometry } from './bundle-fixtures.ts';
import type { FixtureBundleInput } from './bundle-fixtures.ts';

// One fault per gate of PIPE-loader-gates: each changes a valid zzBundle input so that exactly one
// gate fails, `gate` being the name expected first and alone among the failed entries of
// stats.gates.

export type GateFault = {
  label: string;
  gate: string;
  needsPriorLoad: boolean;
  build(base: FixtureBundleInput): FixtureBundleInput;
};

/** A geometry version no base input uses, so a fault's geometry is always staged. */
const FAULT_GEOMETRY_VERSION = '20270103T000000Z-geometry';
const SHRINK_DROPPED_ROWS = 51; // 5.1% of 1,000

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function rowsOf(input: FixtureBundleInput, file: FullFileR0): Record<string, unknown>[] {
  const rows = input.files[file];
  if (rows === undefined || rows.length === 0) {
    throw new Error(`The base input has no ${file} rows.`);
  }
  return rows;
}

function firstRow(input: FixtureBundleInput, file: FullFileR0): Record<string, unknown> {
  const [row] = rowsOf(input, file);
  if (row === undefined) {
    throw new Error(`The base input has no ${file} rows.`);
  }
  return row;
}

/** A copy of the input whose geometry is its own (or zzGeometry's) under a fresh version. */
function withFreshGeometry(input: FixtureBundleInput): FixtureBundleInput & {
  geometry: NonNullable<FixtureBundleInput['geometry']>;
} {
  const geometry = structuredClone(input.geometry ?? zzGeometry());
  return {
    ...input,
    geometry: { version: FAULT_GEOMETRY_VERSION, states: geometry.states, zip: geometry.zip },
  };
}

function firstGeometryRow(
  geometry: NonNullable<FixtureBundleInput['geometry']>,
  key?: string,
): Record<string, unknown> {
  for (const rows of Object.values(geometry.states)) {
    const row = rows.find((candidate) => key === undefined || candidate.source_key === key);
    if (row !== undefined) {
      return row;
    }
  }
  throw new Error('The geometry has no such row.');
}

export const GATE_FAULTS: readonly GateFault[] = [
  {
    label: 'revision',
    gate: 'schema_compatible',
    needsPriorLoad: false,
    build: (base) => ({
      ...structuredClone(base),
      manifest: { ...base.manifest, schema_revision: LOADER_SCHEMA_REVISION + 1 },
    }),
  },
  {
    label: 'pipeline-check',
    gate: 'pipeline_checks',
    needsPriorLoad: false,
    build: (base) => ({
      ...structuredClone(base),
      manifest: {
        ...base.manifest,
        checks: [{ name: 'join_rate', passed: false, detail: 'fixture' }],
      },
    }),
  },
  {
    label: 'flipped-byte',
    gate: 'checksums',
    needsPriorLoad: false,
    build: (base) => ({
      ...structuredClone(base),
      corrupt: { file: 'offices', mode: 'flip_byte' },
    }),
  },
  {
    label: 'missing-file',
    gate: 'checksums',
    needsPriorLoad: false,
    build: (base) => ({ ...structuredClone(base), corrupt: { file: 'offices', mode: 'missing' } }),
  },
  {
    label: 'javascript-link',
    gate: 'schema_valid',
    needsPriorLoad: false,
    build: (base) => {
      const input = structuredClone(base);
      firstRow(input, 'office_powers').source_url = 'javascript:alert(1)';
      return input;
    },
  },
  {
    label: 'outline-markup',
    gate: 'schema_valid',
    needsPriorLoad: false,
    build: (base) => {
      const input = withFreshGeometry(structuredClone(base));
      firstGeometryRow(input.geometry).outline_svg = '<svg onload=1>';
      return input;
    },
  },
  {
    label: 'shrink',
    gate: 'shrink:office_powers',
    needsPriorLoad: true,
    build: (base) => {
      const input = structuredClone(base);
      const rows = rowsOf(input, 'office_powers');
      input.files.office_powers = rows.slice(0, Math.max(rows.length - SHRINK_DROPPED_ROWS, 0));
      return input;
    },
  },
  {
    label: 'missing-district',
    gate: 'references',
    needsPriorLoad: false,
    build: (base) => {
      const input = structuredClone(base);
      firstRow(input, 'offices').district_key = 'tiger:county:99999';
      return input;
    },
  },
  {
    label: 'unknown-type',
    gate: 'reference_ids',
    needsPriorLoad: false,
    build: (base) => {
      const input = structuredClone(base);
      firstRow(input, 'offices').office_type_id = 'fixture-unknown-type';
      return input;
    },
  },
  {
    label: 'late-track',
    gate: 'deadlines_before_elections',
    needsPriorLoad: false,
    build: (base) => {
      const input = structuredClone(base);
      const trackRow = firstRow(input, 'filing_tracks');
      const election = rowsOf(input, 'elections').find(
        (row) => row.source_key === trackRow.election_key,
      );
      if (election === undefined || typeof election.election_date !== 'string') {
        throw new Error('The base input has no election for its first track.');
      }
      const next = new Date(
        Date.parse(`${election.election_date}T00:00:00.000Z`) + 24 * 60 * 60 * 1000,
      );
      trackRow.closes_on = next.toISOString().slice(0, 10);
      return input;
    },
  },
  {
    label: 'street-address',
    gate: 'personal_data',
    needsPriorLoad: false,
    build: (base) => {
      const input = structuredClone(base);
      firstRow(input, 'people').name = 'Fixture 12 Main Street';
      return input;
    },
  },
  {
    label: 'no-geometry',
    gate: 'geometry',
    needsPriorLoad: false,
    build: (base) => {
      const input = withFreshGeometry(structuredClone(base));
      // A new hash on both rows, so neither a staged nor a loaded shape stands in.
      const changed = hash('fixture-no-geometry');
      const districtRow = rowsOf(input, 'districts').find(
        (row) => row.geometry_quality === 'exact',
      );
      if (districtRow === undefined) {
        throw new Error('The base input has no exact district.');
      }
      const geometryRow = firstGeometryRow(input.geometry, String(districtRow.source_key));
      districtRow.geom_hash = changed;
      geometryRow.geom_hash = changed;
      geometryRow.lookup_wkb = null;
      return input;
    },
  },
  {
    label: 'bad-asset',
    gate: 'assets',
    needsPriorLoad: false,
    build: (base) => {
      const input = structuredClone(base);
      const listedAs = hash('fixture-bad-asset');
      const person = firstRow(input, 'people');
      person.photo = fixturePhotoRecord(`../../assets/photos/${listedAs}.jpg`, '2027-01-01');
      input.assets = [
        ...(input.assets ?? []),
        { kind: 'photo', bytes: new TextEncoder().encode('fixture photo bytes'), sha256: listedAs },
      ];
      return input;
    },
  },
];
