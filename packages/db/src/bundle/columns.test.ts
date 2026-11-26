import { getTableColumns } from 'drizzle-orm';
import type { Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { elections, filingTracks, officePowers, offices } from '../schema/civic.ts';
import { districts, jurisdictions } from '../schema/geo.ts';
import { givenNameAliases, officeholders, people, personAliases } from '../schema/people.ts';
import { KEY_COLUMNS, LOADER_COLUMNS, RETIRING_TABLES } from './columns.ts';
import type { LoaderTable } from './columns.ts';

const TABLES: { readonly [T in LoaderTable]: Table } = {
  jurisdictions,
  districts,
  offices,
  office_powers: officePowers,
  elections,
  filing_tracks: filingTracks,
  people,
  person_aliases: personAliases,
  given_name_aliases: givenNameAliases,
  officeholders,
};

function columnNames(table: Table): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const NEVER_RECORDED = [
  'claimed_by',
  'donate_url',
  'volunteer_url',
  'pending_links',
  'photo_pending_key',
  'overrides',
  'search',
  'geom',
  'geom_hash',
  'outline_svg',
  'outline_bbox',
  'label_point',
  'updated_at',
  'next_election_id',
  'next_filing_deadline',
  'completeness',
  'name_key',
  'merged_into',
  // The score columns of J-score.offices.
  'scale',
  'pivot',
  'term_factor',
  'ease',
  'ease_inputs',
  'ease_confidence',
  'entrenched',
  'decided_in',
  'votes_to_win',
  'votes_low',
  'votes_high',
  'votes_estimated',
  'effort',
  'rank_base',
];

describe('the loader columns', () => {
  it('every recorded column exists', () => {
    for (const [table, drizzleTable] of Object.entries(TABLES) as [LoaderTable, Table][]) {
      const names = columnNames(drizzleTable);
      for (const column of LOADER_COLUMNS[table]) {
        expect(names, `${table}.${column.name}`).toContain(column.name);
      }
      for (const key of KEY_COLUMNS[table]) {
        expect(names, `${table}.${key}`).toContain(key);
      }
    }
  });

  it('nothing private is recorded', () => {
    for (const table of Object.keys(TABLES) as LoaderTable[]) {
      const recorded = LOADER_COLUMNS[table].map((column) => column.name);
      for (const name of NEVER_RECORDED) {
        expect(recorded, `${table} records ${name}`).not.toContain(name);
      }
    }
    // The headline columns are derived by L-headline-deadline, so a revert recomputes them.
    const electionColumns = LOADER_COLUMNS.elections.map((column) => column.name);
    for (const name of [
      'filing_opens',
      'filing_deadline',
      'filing_deadline_time',
      'petition_due',
      'deadline_basis',
    ]) {
      expect(electionColumns).not.toContain(name);
    }
  });

  it('records no column twice and keeps the key columns of the retiring tables', () => {
    for (const table of Object.keys(TABLES) as LoaderTable[]) {
      const recorded = LOADER_COLUMNS[table].map((column) => column.name);
      expect(new Set(recorded).size).toBe(recorded.length);
    }
    for (const table of RETIRING_TABLES) {
      const recorded = LOADER_COLUMNS[table].map((column) => column.name);
      expect(recorded).toContain('source_key');
      expect(recorded).toContain('retired_at');
      expect(KEY_COLUMNS[table]).toEqual(['id']);
    }
    expect(LOADER_COLUMNS.person_aliases).toEqual([]);
  });
});
