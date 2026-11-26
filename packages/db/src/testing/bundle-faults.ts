import { createHash } from 'node:crypto';
import { LOADER_SCHEMA_REVISION } from '@citizenrun/shared';
import type { FullFileR0 } from '../bundle/tables.ts';
import { fixturePhotoRecord, zzBundle, zzGeometry } from './bundle-fixtures.ts';
import type { FixtureBundleInput, FixtureRows } from './bundle-fixtures.ts';

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

// One entry per side of each hold (PIPE-loader-hold-revert): each changes a
// second bundle against a first load of `first(today)` so that it crosses its own hold, or stays
// just under it, and no other.

export type HoldFault = {
  label: string;
  /** The hold the second load crosses, alone; null when it stays just under every hold. */
  hold: string | null;
  /** The rows of the first load. */
  first(today: string): FixtureRows;
  /** The second bundle: `base` (the first load's rows under a new version) with the entry's change; `live` is the first load's rows. */
  build(base: FixtureBundleInput, live: FixtureRows): FixtureBundleInput;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Moves the closing date of the first `count` tracks one day earlier: one track per office, each of its own election. */
function moveClosingDates(count: number) {
  return (base: FixtureBundleInput): FixtureBundleInput => {
    const input = structuredClone(base);
    const tracks = input.files.filing_tracks ?? [];
    if (tracks.length < count) {
      throw new Error('The base input has too few tracks.');
    }
    for (const track of tracks.slice(0, count)) {
      track.closes_on = dayBefore(String(track.closes_on));
    }
    return input;
  };
}

/** Gives the first `count` offices a new title. */
function retitle(count: number) {
  return (base: FixtureBundleInput): FixtureBundleInput => {
    const input = structuredClone(base);
    const offices = input.files.offices ?? [];
    if (offices.length < count) {
      throw new Error('The base input has too few offices.');
    }
    offices.slice(0, count).forEach((office, index) => {
      office.title = `Fixture Retitled Seat ${String(index + 1)}`;
    });
    return input;
  };
}

export const HOLD_FAULTS: readonly HoldFault[] = [
  {
    // 11 of 400 future deadlines: over 2% and more than 10; 11 of 400 offices is under 20%.
    label: 'future-deadlines-over',
    hold: 'future_deadlines',
    first: (today) => zzBundle({ today, offices: 400, electionsPerOffice: 1 }),
    build: moveClosingDates(11),
  },
  {
    // 10 of 400: over 2%, but 10 is not more than 10.
    label: 'future-deadlines-few',
    hold: null,
    first: (today) => zzBundle({ today, offices: 400, electionsPerOffice: 1 }),
    build: moveClosingDates(10),
  },
  {
    // 13 of 600: 1,300 is over 1,200.
    label: 'future-deadlines-share',
    hold: 'future_deadlines',
    first: (today) => zzBundle({ today, offices: 600, electionsPerOffice: 1 }),
    build: moveClosingDates(13),
  },
  {
    // 12 of 600: 1,200 is not over 1,200.
    label: 'future-deadlines-share-at',
    hold: null,
    first: (today) => zzBundle({ today, offices: 600, electionsPerOffice: 1 }),
    build: moveClosingDates(12),
  },
  {
    // 5 of 20 live ZZ offices retitled: 500 is over 400.
    label: 'offices-over',
    hold: 'offices_changed:ZZ',
    first: (today) => zzBundle({ today }),
    build: retitle(5),
  },
  {
    // 4 of 20: 400 is not over 400.
    label: 'offices-at',
    hold: null,
    first: (today) => zzBundle({ today }),
    build: retitle(4),
  },
];
