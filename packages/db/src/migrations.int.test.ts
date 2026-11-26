import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { ISSUE_IDS, STATE_CODES } from '@citizenrun/shared';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { CLIENT_ERRORS_RETENTION_DAYS } from './index.ts';
import { runMigrations } from './migrator.ts';
import {
  getTestDb,
  insertClientError,
  insertElection,
  insertFilingTrack,
  insertJurisdiction,
  insertOfficePower,
  resetDb,
} from './testing/index.ts';
import { parseStamp } from './testing/names.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  harnessSettings,
} from './testing/settings.ts';

// TEST-migrations: every named object the migrations build. A migration that adds a table adds
// its objects here.
const EXPECTED_OBJECTS = {
  extensions: ['citext', 'pg_trgm', 'postgis', 'unaccent'],
  tables: [
    'client_errors',
    'worker_heartbeats',
    'issues',
    'users',
    'auth_identities',
    'email_codes',
    'sessions',
    'auth_challenges',
    'user_consents',
    'reserved_handles',
    'user_issues',
    'uploads',
    'rate_limits',
    'usage_counters',
    'state_rules',
    'app_events',
    'data_exports',
    'powers',
    'issue_powers',
    'office_types',
    'jurisdictions',
    'districts',
    'district_parts',
    'district_fallbacks',
    'district_display',
    'zip_centroids',
    'offices',
    'office_powers',
    'office_issues',
    'elections',
    'filing_tracks',
    'results',
    'people',
    'person_aliases',
    'given_name_aliases',
    'officeholders',
    'candidacies',
    'candidacy_filings',
    'unmatched_filings',
    'data_bundles',
    'bundle_changes',
  ],
  indexes: [
    'client_errors_created',
    'client_errors_pkey',
    'worker_heartbeats_pkey',
    'issues_pkey',
    'issues_sort_key',
    'users_pkey',
    'users_handle_key',
    'users_email_key',
    'users_calendar_token_hash_key',
    'users_handle_trgm',
    'users_name_trgm',
    'users_not_active',
    'users_bio_held',
    'users_age_unset',
    'auth_identities_pkey',
    'auth_identities_user',
    'email_codes_pkey',
    'email_codes_pending_token_hash_key',
    'email_codes_email',
    'sessions_pkey',
    'sessions_token_hash_key',
    'sessions_user',
    'sessions_expires',
    'auth_challenges_pkey',
    'auth_challenges_secret_hash_key',
    'auth_challenges_expires',
    'auth_challenges_session',
    'user_consents_pkey',
    'user_consents_user',
    'reserved_handles_pkey',
    'reserved_handles_until',
    'user_issues_pkey',
    'uploads_pkey',
    'uploads_key_key',
    'uploads_user',
    'uploads_unconsumed',
    'rate_limits_pkey',
    'rate_limits_window',
    'usage_counters_pkey',
    'state_rules_pkey',
    'app_events_pkey',
    'app_events_user',
    'app_events_name',
    'data_exports_pkey',
    'data_exports_user',
    'data_exports_ready',
    'powers_pkey',
    'powers_search',
    'issue_powers_pkey',
    'issue_powers_power',
    'office_types_pkey',
    'jurisdictions_pkey',
    'districts_pkey',
    'district_parts_pkey',
    'district_fallbacks_pkey',
    'district_display_pkey',
    'zip_centroids_pkey',
    'offices_pkey',
    'office_powers_pkey',
    'office_issues_pkey',
    'elections_pkey',
    'filing_tracks_pkey',
    'results_pkey',
    'people_pkey',
    'person_aliases_pkey',
    'given_name_aliases_pkey',
    'officeholders_pkey',
    'candidacies_pkey',
    'candidacy_filings_pkey',
    'unmatched_filings_pkey',
    'data_bundles_pkey',
    'bundle_changes_pkey',
    'jurisdictions_source_key_key',
    'jurisdictions_census_id_key',
    'districts_source_key_key',
    'districts_tile_id_key',
    'offices_source_key_key',
    'offices_slug_key',
    'offices_tile_id_key',
    'elections_source_key_key',
    'elections_contest_key',
    'filing_tracks_source_key_key',
    'filing_tracks_track_key',
    'results_source_key_key',
    'results_contest_key',
    'people_source_key_key',
    'people_slug_key',
    'officeholders_source_key_key',
    'candidacies_filing_key_key',
    'candidacies_person_election_key',
    'unmatched_filings_filing_key_key',
    'data_bundles_version_key',
    'jurisdictions_state',
    'jurisdictions_parent',
    'jurisdictions_name_trgm',
    'districts_geom',
    'districts_label_point',
    'districts_jurisdiction',
    'districts_level',
    'district_parts_geom',
    'district_parts_district',
    'district_fallbacks_via',
    'district_display_band0',
    'district_display_band1',
    'district_display_band2',
    'district_display_band3',
    'offices_search',
    'offices_title_trgm',
    'offices_district',
    'offices_jurisdiction',
    'offices_office_type',
    'offices_state_rank',
    'offices_state_spt',
    'offices_state_ease',
    'offices_state_pay',
    'offices_state_deadline',
    'office_powers_power',
    'office_issues_issue',
    'elections_deadline',
    'elections_date',
    'elections_opens',
    'filing_tracks_closes',
    'results_date',
    'results_election',
    'people_name_trgm',
    'people_name_key_trgm',
    'people_last_name',
    'people_one_owner',
    'people_photo_key',
    'people_pending_links',
    'person_aliases_trgm',
    'given_name_aliases_alias',
    'officeholders_office',
    'officeholders_person',
    'candidacies_election',
    'candidacies_created',
    'candidacy_filings_candidacy',
    'candidacy_filings_source',
    'unmatched_filings_open',
    'data_bundles_loaded',
    'bundle_changes_bundle',
  ],
  constraints: [
    'client_errors_platform_check',
    'issues_id_check',
    'users_handle_check',
    'users_link_check',
    'users_bio_ai_screen_status_check',
    'users_email_status_check',
    'users_role_check',
    'users_status_check',
    'users_suspended_reason_check',
    'users_suspended_at_check',
    'users_age_method_check',
    'users_age_result_check',
    'users_age_source_tier_check',
    'users_age_record_check',
    'users_onboarding_step_check',
    'users_dm_policy_check',
    'users_tag_policy_check',
    'users_locale_check',
    'users_location_precision_check',
    'auth_identities_provider_check',
    'sessions_platform_check',
    'auth_challenges_kind_check',
    'auth_challenges_platform_check',
    'auth_challenges_session_id_check',
    'user_consents_kind_check',
    'user_consents_platform_check',
    'reserved_handles_reason_check',
    'uploads_kind_check',
    'uploads_purpose_check',
    'uploads_platform_check',
    'uploads_content_type_check',
    'uploads_sha256_check',
    'state_rules_state_check',
    'state_rules_signup_check',
    'state_rules_age_method_check',
    'app_events_platform_check',
    'data_exports_status_check',
    'powers_id_check',
    'office_types_id_check',
    'office_types_level_check',
    'office_types_electorate_check',
    'jurisdictions_kind_check',
    'jurisdictions_state_check',
    'jurisdictions_website_check',
    'districts_level_check',
    'districts_geometry_quality_check',
    'districts_lean_check',
    'districts_lean_basis_check',
    'districts_outline_svg_check',
    'districts_outline_bbox_check',
    'district_parts_level_check',
    'district_fallbacks_distinct_check',
    'district_display_zoom_band_check',
    'district_display_level_check',
    'zip_centroids_zip_check',
    'zip_centroids_state_check',
    'offices_slug_check',
    'offices_state_check',
    'offices_seats_check',
    'offices_seats_up_next_check',
    'offices_vacant_seats_up_next_check',
    'offices_party_selection_check',
    'offices_pay_kind_check',
    'offices_pay_period_check',
    'offices_benefits_check',
    'offices_meeting_times_check',
    'offices_fits_day_job_check',
    'offices_ease_check',
    'offices_ease_confidence_check',
    'offices_decided_in_check',
    'offices_completeness_check',
    'office_powers_relevance_check',
    'office_powers_confidence_check',
    'office_powers_source_url_check',
    'office_issues_relevance_check',
    'elections_kind_check',
    'elections_party_check',
    'elections_deadline_basis_check',
    'elections_turnout_class_check',
    'elections_filing_window_check',
    'elections_filing_deadline_check',
    'filing_tracks_track_check',
    'filing_tracks_basis_check',
    'filing_tracks_confidence_check',
    'filing_tracks_window_check',
    'filing_tracks_source_url_check',
    'results_kind_check',
    'results_turnout_class_check',
    'results_party_check',
    'results_source_url_check',
    'people_slug_check',
    'people_party_check',
    'people_website_check',
    'people_donate_url_check',
    'people_volunteer_url_check',
    'people_photo_source_url_check',
    'given_name_aliases_source_check',
    'officeholders_cash_source_url_check',
    'candidacies_status_check',
    'candidacies_party_check',
    'candidacies_match_confidence_check',
    'candidacies_source_url_check',
    'candidacy_filings_status_check',
    'candidacy_filings_source_url_check',
    'unmatched_filings_kind_check',
    'unmatched_filings_resolution_check',
    'data_bundles_kind_check',
    'data_bundles_status_check',
    'bundle_changes_op_check',
  ],
  // Primary keys and unique constraints, under PostgreSQL's names.
  keys: [
    'client_errors_pkey',
    'worker_heartbeats_pkey',
    'issues_pkey',
    'issues_sort_key',
    'users_pkey',
    'users_handle_key',
    'users_email_key',
    'users_calendar_token_hash_key',
    'auth_identities_pkey',
    'email_codes_pkey',
    'email_codes_pending_token_hash_key',
    'sessions_pkey',
    'sessions_token_hash_key',
    'auth_challenges_pkey',
    'auth_challenges_secret_hash_key',
    'user_consents_pkey',
    'reserved_handles_pkey',
    'user_issues_pkey',
    'uploads_pkey',
    'uploads_key_key',
    'rate_limits_pkey',
    'usage_counters_pkey',
    'state_rules_pkey',
    'app_events_pkey',
    'data_exports_pkey',
    'powers_pkey',
    'issue_powers_pkey',
    'office_types_pkey',
    'jurisdictions_pkey',
    'districts_pkey',
    'district_parts_pkey',
    'district_fallbacks_pkey',
    'district_display_pkey',
    'zip_centroids_pkey',
    'offices_pkey',
    'office_powers_pkey',
    'office_issues_pkey',
    'elections_pkey',
    'filing_tracks_pkey',
    'results_pkey',
    'people_pkey',
    'person_aliases_pkey',
    'given_name_aliases_pkey',
    'officeholders_pkey',
    'candidacies_pkey',
    'candidacy_filings_pkey',
    'unmatched_filings_pkey',
    'data_bundles_pkey',
    'bundle_changes_pkey',
    'jurisdictions_source_key_key',
    'jurisdictions_census_id_key',
    'districts_source_key_key',
    'districts_tile_id_key',
    'offices_source_key_key',
    'offices_slug_key',
    'offices_tile_id_key',
    'elections_source_key_key',
    'elections_contest_key',
    'filing_tracks_source_key_key',
    'filing_tracks_track_key',
    'results_source_key_key',
    'results_contest_key',
    'people_source_key_key',
    'people_slug_key',
    'officeholders_source_key_key',
    'candidacies_filing_key_key',
    'candidacies_person_election_key',
    'unmatched_filings_filing_key_key',
    'data_bundles_version_key',
  ],
  functions: [
    'os_drop_month_partitions',
    'os_ensure_month_partitions',
    'os_unaccent',
    'os_name_key',
  ],
} as const;

// Each foreign key with its delete rule: `c` cascade, `n` set null, `a` no action.
const EXPECTED_FOREIGN_KEYS: Readonly<Record<string, 'a' | 'c' | 'n'>> = {
  auth_identities_user_id_fkey: 'c',
  sessions_user_id_fkey: 'c',
  auth_challenges_user_id_fkey: 'c',
  auth_challenges_session_id_fkey: 'c',
  user_consents_user_id_fkey: 'c',
  user_issues_user_id_fkey: 'c',
  user_issues_issue_id_fkey: 'a',
  uploads_user_id_fkey: 'c',
  data_exports_user_id_fkey: 'c',
  state_rules_updated_by_fkey: 'n',
  issue_powers_issue_id_fkey: 'a',
  issue_powers_power_id_fkey: 'a',
  jurisdictions_parent_id_fkey: 'a',
  districts_jurisdiction_id_fkey: 'a',
  district_parts_district_id_fkey: 'c',
  district_fallbacks_district_id_fkey: 'c',
  district_fallbacks_via_district_id_fkey: 'c',
  district_display_district_id_fkey: 'c',
  offices_jurisdiction_id_fkey: 'a',
  offices_district_id_fkey: 'a',
  offices_office_type_id_fkey: 'a',
  offices_next_election_id_fkey: 'n',
  office_powers_office_id_fkey: 'c',
  office_powers_power_id_fkey: 'a',
  office_issues_office_id_fkey: 'c',
  office_issues_issue_id_fkey: 'a',
  elections_office_id_fkey: 'c',
  filing_tracks_election_id_fkey: 'c',
  results_office_id_fkey: 'c',
  results_election_id_fkey: 'n',
  people_claimed_by_fkey: 'n',
  people_merged_into_fkey: 'a',
  person_aliases_person_id_fkey: 'c',
  officeholders_office_id_fkey: 'c',
  officeholders_person_id_fkey: 'a',
  candidacies_person_id_fkey: 'a',
  candidacies_election_id_fkey: 'c',
  candidacy_filings_candidacy_id_fkey: 'c',
  unmatched_filings_office_id_fkey: 'a',
  unmatched_filings_person_id_fkey: 'a',
  unmatched_filings_decided_by_fkey: 'n',
  bundle_changes_bundle_id_fkey: 'c',
};

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK_VIOLATION = '23514';

const scratchDatabases: string[] = [];
const scratchFolders: string[] = [];

// An empty database of this file's own on the harness server, made from template0, never the clone.
async function createScratchDatabase(): Promise<string> {
  const name = `os_t_mig_${randomBytes(3).toString('hex')}`;
  const { databaseUrl } = harnessSettings();
  const admin = await connectHarnessClient(databaseUrl, 'os-test-migrations');
  try {
    await admin.query(`create database ${admin.escapeIdentifier(name)} template template0`);
  } finally {
    await admin.end();
  }
  scratchDatabases.push(name);
  return databaseUrlFor(databaseUrl, name);
}

// `app_events_YYYYMM` for a month counted from January of `year` (a month past 11 rolls over).
function monthPartition(year: number, month: number): string {
  const at = new Date(Date.UTC(year, month, 1));
  return `app_events_${String(at.getUTCFullYear())}${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function rows<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  return getTestDb().execute<T>(query, 'objects');
}

async function namesOf(query: SQL): Promise<string[]> {
  return (await rows<{ name: string }>(query)).map((row) => row.name).sort();
}

// The Postgres error under a Drizzle query error: the first error in the cause chain with a code.
function databaseError(error: unknown): { code?: unknown; constraint?: unknown } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string') {
      return current;
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

function runCheck(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'pnpm',
      ['--filter', '@citizenrun/db', 'run', 'check'],
      { cwd: REPO_ROOT, timeout: 110_000 },
      (error) => {
        resolve(error === null ? 0 : typeof error.code === 'number' ? error.code : 1);
      },
    );
  });
}

afterAll(async () => {
  const { databaseUrl } = harnessSettings();
  const admin = await connectHarnessClient(databaseUrl, 'os-test-migrations');
  try {
    for (const name of scratchDatabases) {
      await dropDatabase(admin, name);
    }
  } finally {
    await admin.end();
  }
  for (const folder of scratchFolders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('the migrations', () => {
  it('applies from empty', async () => {
    const url = await createScratchDatabase();
    await expect(
      runMigrations(url, { migrationsFolder: harnessSettings().migrationsDir }),
    ).resolves.toMatchObject({ applied: expect.any(Number) as number });
    const client = await connectHarnessClient(url, 'os-test-migrations');
    try {
      const found = await client.query<{ name: string }>(
        `select table_name as name from information_schema.tables
         where table_schema = 'public' and table_name in ('client_errors', 'worker_heartbeats')
         order by table_name`,
      );
      expect(found.rows.map((row) => row.name)).toEqual(['client_errors', 'worker_heartbeats']);
    } finally {
      await client.end();
    }
  });

  it('schema and migrations agree', { timeout: 120_000 }, async () => {
    expect(await runCheck()).toBe(0);
  });

  it('every named object exists', async () => {
    expect(
      await namesOf(sql`select extname as name from pg_extension
        where extname in ${EXPECTED_OBJECTS.extensions}`),
    ).toEqual([...EXPECTED_OBJECTS.extensions].sort());
    expect(
      await namesOf(sql`select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
          and c.relname in ${EXPECTED_OBJECTS.tables}`),
    ).toEqual([...EXPECTED_OBJECTS.tables].sort());
    expect(
      await namesOf(sql`select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('i', 'I')
          and c.relname in ${EXPECTED_OBJECTS.indexes}`),
    ).toEqual([...EXPECTED_OBJECTS.indexes].sort());
    expect(
      await namesOf(sql`select distinct conname as name from pg_constraint
        where contype = 'c' and conname in ${EXPECTED_OBJECTS.constraints}`),
    ).toEqual([...EXPECTED_OBJECTS.constraints].sort());
    expect(
      await namesOf(sql`select distinct conname as name from pg_constraint
        where contype in ('p', 'u') and conname in ${EXPECTED_OBJECTS.keys}`),
    ).toEqual([...EXPECTED_OBJECTS.keys].sort());
    const foreignKeys = await rows<{ name: string; rule: string }>(
      sql`select conname as name, confdeltype::text as rule from pg_constraint
          where contype = 'f' and conname in ${Object.keys(EXPECTED_FOREIGN_KEYS)}`,
    );
    expect(Object.fromEntries(foreignKeys.map((key) => [key.name, key.rule]))).toEqual(
      EXPECTED_FOREIGN_KEYS,
    );
    expect(
      await namesOf(sql`select proname as name from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname in ${EXPECTED_OBJECTS.functions}`),
    ).toEqual([...EXPECTED_OBJECTS.functions].sort());
    const [rateLimits] = await rows<{ persistence: string; options: string[] | null }>(
      sql`select relpersistence::text as persistence, reloptions as options from pg_class
          where oid = 'public.rate_limits'::regclass`,
    );
    expect(rateLimits?.persistence).toBe('u');
    expect(rateLimits?.options).toContain('fillfactor=70');
    const [keyColumn] = await rows<{ collation: string | null }>(
      sql`select collation_name as collation from information_schema.columns
          where table_schema = 'public' and table_name = 'rate_limits' and column_name = 'key'`,
    );
    expect(keyColumn?.collation).toBe('C');
    // Schema `staging` holds the two load tables, both unlogged, outside the Drizzle schema.
    const staging = await rows<{ name: string; kind: string; persistence: string }>(
      sql`select c.relname as name, c.relkind::text as kind, c.relpersistence::text as persistence
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'staging' and c.relkind in ('r', 'i')
          order by c.relname`,
    );
    expect(staging).toEqual([
      { name: 'bundle_rows', kind: 'r', persistence: 'u' },
      { name: 'bundle_rows_key', kind: 'i', persistence: 'u' },
      { name: 'bundle_rows_pkey', kind: 'i', persistence: 'u' },
      { name: 'district_geometry', kind: 'r', persistence: 'u' },
      { name: 'district_geometry_pkey', kind: 'i', persistence: 'u' },
    ]);
    const [unloggedElsewhere] = await rows<{ n: number }>(
      sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relpersistence = 'u'
            and c.relname <> 'rate_limits'`,
    );
    expect(unloggedElsewhere?.n).toBe(0);
  });

  it('identity ids stay under two to the fifty-third', async () => {
    const found = await rows<{ name: string; max: string }>(
      sql`select c.relname as name, s.seqmax::text as max from pg_sequence s
          join pg_class c on c.oid = s.seqrelid
          where c.oid in (pg_get_serial_sequence('districts', 'tile_id')::regclass,
                          pg_get_serial_sequence('offices', 'tile_id')::regclass)
          order by c.relname`,
    );
    expect(found).toEqual([
      { name: 'districts_tile_id_seq', max: '9007199254740991' },
      { name: 'offices_tile_id_seq', max: '9007199254740991' },
    ]);
  });

  it('a deadline after the election is refused', async () => {
    const election = await insertElection(getTestDb(), { electionDate: '2027-06-01' });
    const error = await insertFilingTrack(getTestDb(), {
      electionId: election.id,
      opensOn: '2027-05-01',
      closesOn: '2027-06-02',
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(databaseError(error)).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'elections_filing_deadline_check',
    });
    const [tracks] = await rows<{ n: number }>(
      sql`select count(*)::int as n from filing_tracks where election_id = ${election.id}`,
    );
    expect(tracks?.n).toBe(0);
    const [headline] = await rows<{ deadline: string | null }>(
      sql`select filing_deadline::text as deadline from elections where id = ${election.id}`,
    );
    expect(headline?.deadline).toBeNull();
  });

  it('links are https only', async () => {
    const db = getTestDb();
    const cases: readonly [() => Promise<unknown>, string][] = [
      [
        () => insertJurisdiction(db, { website: 'http://example.test' }),
        'jurisdictions_website_check',
      ],
      [
        () => insertOfficePower(db, { sourceUrl: 'http://example.test' }),
        'office_powers_source_url_check',
      ],
      [
        () => insertFilingTrack(db, { sourceUrl: 'http://example.test' }),
        'filing_tracks_source_url_check',
      ],
    ];
    for (const [attempt, constraint] of cases) {
      const error = await attempt().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(databaseError(error)).toMatchObject({ code: CHECK_VIOLATION, constraint });
    }
  });

  it('app events are partitioned by month', async () => {
    const [parent] = await rows<{ kind: string }>(
      sql`select relkind::text as kind from pg_class where oid = 'public.app_events'::regclass`,
    );
    expect(parent?.kind).toBe('p');
    const built = parseStamp(inject('harness').templateName);
    if (built === null) {
      throw new Error('The template name carries no stamp.');
    }
    const expected = Array.from({ length: 25 }, (_, offset) =>
      monthPartition(built.getUTCFullYear(), built.getUTCMonth() + offset),
    );
    const partitions = await namesOf(sql`select c.relname as name from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'public.app_events'::regclass`);
    expect(partitions).toEqual(expected);
    // Months that have begun since the template was built get their partition now; none else.
    const now = new Date();
    const monthsSince =
      (now.getUTCFullYear() - built.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - built.getUTCMonth());
    const [made] = await rows<{ made: number }>(
      sql`select os_ensure_month_partitions('app_events', 24) as made`,
    );
    expect(made?.made).toBe(monthsSince);
  });

  it('old partitions are dropped', async () => {
    const db = getTestDb();
    await db.execute(
      sql`create table app_events_200001 partition of app_events
          for values from ('2000-01-01 00:00:00+00') to ('2000-02-01 00:00:00+00')`,
    );
    const [first] = await rows<{ dropped: number }>(
      sql`select os_drop_month_partitions('app_events', 180) as dropped`,
    );
    expect(first?.dropped).toBe(1);
    const [gone] = await rows<{ present: boolean }>(
      sql`select to_regclass('public.app_events_200001') is not null as present`,
    );
    expect(gone?.present).toBe(false);
    const [second] = await rows<{ dropped: number }>(
      sql`select os_drop_month_partitions('app_events', 180) as dropped`,
    );
    expect(second?.dropped).toBe(0);
  });

  it('state rules hold the 56 codes', async () => {
    const found = await rows<{
      state: string;
      signup: string;
      age_method: string;
      candidate_tools: boolean;
      updated_by: string | null;
    }>(
      sql`select state, signup, age_method, candidate_tools, updated_by from state_rules order by state`,
    );
    expect(found).toHaveLength(57);
    expect(
      found
        .map((row) => row.state)
        .filter((state) => state !== 'ZZ')
        .sort(),
    ).toEqual([...STATE_CODES].sort());
    expect(found.filter((row) => row.state === 'ZZ')).toHaveLength(1);
    for (const row of found) {
      expect(row).toMatchObject({
        signup: 'allow',
        age_method: 'store_signal_or_dob',
        candidate_tools: true,
        updated_by: null,
      });
    }
  });

  it('issues hold 19 rows', async () => {
    const found = await rows<{ id: string; icon: string }>(
      sql`select id, icon from issues order by sort`,
    );
    expect(found.map((row) => row.id)).toEqual([...ISSUE_IDS]);
    expect(found.every((row) => row.icon === row.id)).toBe(true);
  });

  it('name keys are immutable functions', async () => {
    const found = await rows<{ name: string; volatility: string; strict: boolean }>(
      sql`select proname as name, provolatile::text as volatility, proisstrict as strict
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname in ('os_unaccent', 'os_name_key')
          order by proname`,
    );
    expect(found).toEqual([
      { name: 'os_name_key', volatility: 'i', strict: false },
      { name: 'os_unaccent', volatility: 'i', strict: true },
    ]);
  });

  it('the name key follows its definition', async () => {
    const [found] = await rows<{
      accented: string | null;
      lastOnly: string | null;
      spaced: string | null;
      nulls: string | null;
      empty: string | null;
    }>(
      sql`select os_name_key('José', 'O''Brien-García') as accented,
                 os_name_key(null, 'Cher') as "lastOnly",
                 os_name_key('  Mary-Kate ', ' Olsen  ') as spaced,
                 os_name_key(null, null) as nulls,
                 os_name_key('', '') as empty`,
    );
    expect(found).toEqual({
      accented: 'jose obriengarcia',
      lastOnly: 'cher',
      spaced: 'marykate olsen',
      nulls: null,
      empty: null,
    });
  });

  it('reference tables hold their rows', async () => {
    await resetDb();
    const [counts] = await rows<{
      powers: number;
      blank: number;
      links: number;
      types: number;
    }>(
      sql`select (select count(*)::int from powers) as powers,
                 (select count(*)::int from powers
                   where phrases = '{}'::text[] and search is null) as blank,
                 (select count(*)::int from issue_powers) as links,
                 (select count(*)::int from office_types) as types`,
    );
    expect(counts).toEqual({ powers: 41, blank: 41, links: 78, types: 42 });
  });

  it('client_errors refuses an unknown platform', async () => {
    const failure: unknown = await insertClientError(getTestDb(), { platform: 'desktop' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(databaseError(failure)).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'client_errors_platform_check',
    });
  });

  it('client_errors holds no user column', async () => {
    const columns = await namesOf(sql`select column_name as name from information_schema.columns
      where table_schema = 'public' and table_name = 'client_errors'`);
    expect(columns).toEqual(
      [
        'id',
        'name',
        'code',
        'route',
        'component',
        'app_version',
        'platform',
        'frames',
        'request_id',
        'created_at',
      ].sort(),
    );
  });

  it('client_errors has its retention period and the index the cleanup reads', async () => {
    expect(CLIENT_ERRORS_RETENTION_DAYS).toBe(14);
    const found = await rows<{ indexdef: string }>(
      sql`select indexdef from pg_indexes
          where schemaname = 'public' and indexname = 'client_errors_created'`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.indexdef.endsWith('USING btree (created_at)')).toBe(true);
  });

  it('lock timeout is set', async () => {
    const source = harnessSettings().migrationsDir;
    const folder = mkdtempSync(join(tmpdir(), 'os-mig-'));
    scratchFolders.push(folder);
    cpSync(source, folder, { recursive: true });
    // A valid prefix later than any real migration's, so the probe runs last.
    const probe = join(folder, '29991231235959_lock_probe');
    expect(readdirSync(folder).every((name) => name < '29991231235959')).toBe(true);
    mkdirSync(probe);
    writeFileSync(
      join(probe, 'migration.sql'),
      "create table lock_probe as select current_setting('lock_timeout') as v;",
    );
    const url = await createScratchDatabase();
    await runMigrations(url, { migrationsFolder: folder });
    const client = await connectHarnessClient(url, 'os-test-migrations');
    try {
      const result = await client.query<{ v: string }>('select v from lock_probe');
      expect(result.rows.map((row) => row.v)).toEqual(['5s']);
    } finally {
      await client.end();
    }
  });
});
