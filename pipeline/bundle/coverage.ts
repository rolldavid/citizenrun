// PIPE-coverage-stats: written with every full bundle to reports/coverage/<version>.json.
import { IsoInstantSchema, RefIdSchema, StateCodeSchema } from '@citizenrun/shared';
import { z } from 'zod';
import type { StageMeta } from '../lib/runner.ts';
import type { AssembledRows } from './assemble.ts';
import type { BundleInputs, StateInputs } from './inputs.ts';

const n = z.int().min(0);

const ByOfficeTypeSchema = z.strictObject({
  offices: n,
  pay_known: n,
  deadline_known: n,
  fee_known: n,
  signatures_known: n,
  where_known: n,
  results_source: z.enum(['state_export', 'medsl', 'estimate', 'mixed']),
  confidence: z.strictObject({ high: n, medium: n, low: n }),
});

const StateStatsSchema = z.strictObject({
  units: z.strictObject({
    county: n,
    city: n,
    township: n,
    school_district: n,
    special_district: n,
    coop: n,
    party: n,
  }),
  units_with_website: n,
  units_website_valid: n,
  districts: z.strictObject({ exact: n, parent_fallback: n, county_approx: n }),
  offices: z.strictObject({ total: n, placeholder: n }),
  by_office_type: z.record(RefIdSchema, ByOfficeTypeSchema),
  template: z.enum(['valid', 'invalid', 'none']),
  rules: z
    .strictObject({ fixtures: n, passing: z.boolean(), newest_source: z.string().nullable() })
    .nullable(),
  filing_adapter: z.strictObject({
    id: z.string().nullable(),
    status: z.enum(['adapter', 'none']),
    reason: z.string().nullable(),
  }),
  blocked_hosts: z.array(z.string()),
  ai: z.strictObject({ units_extracted: n, units_queued: n, budget_exhausted: z.boolean() }),
  quotes_ungrounded: n,
  reported: z.record(z.string().min(1), n),
});

/** PIPE-coverage-stats without `filing_adapters` and `results_export`, which come with the filing adapters. */
export const CoverageStatsSchema = z.strictObject({
  version: z.string().regex(/^\d{8}T\d{6}Z-full$/),
  generated_at: IsoInstantSchema,
  states: z.record(StateCodeSchema, StateStatsSchema),
  missing_states: z.array(StateCodeSchema),
});
export type CoverageStats = z.infer<typeof CoverageStatsSchema>;
type StateStats = z.infer<typeof StateStatsSchema>;

/** The fields of CoverageStats that stage 1's counters fill; every other counter is reported. */
const STAGE1_FIELDS = /^(units:[a-z_]+|units_with_website|units_website_valid|districts:[a-z_]+)$/;

const ACT_ON_OFFICE_FIELDS = [
  'pay_annual_cents',
  'pay_amount_cents',
  'filing_fee_cents',
  'signatures_required',
  'where_to_file',
] as const;

const COUNT_PAIR = /^([A-Za-z0-9_:.-]+)=(\d+)$/;

export type CoverageInput = {
  readonly version: string;
  readonly now: Date;
  readonly today: string;
  readonly inputs: BundleInputs;
  /** Each bundle state's rows after step 4, with the writer's own counts. */
  readonly states: readonly {
    readonly state: string;
    readonly rows: AssembledRows;
    readonly counts: Readonly<Record<string, number>>;
  }[];
  /** The states with a data/templates/<st>.yaml file. */
  readonly templateStates: ReadonlySet<string>;
  /** The rules entry of each state: null when the state has no rules module. */
  readonly rules: ReadonlyMap<
    string,
    {
      readonly fixtures: number;
      readonly passing: boolean;
      readonly newest_source: string | null;
    } | null
  >;
  /** Each stage's blocking check names; the other checks with `name=count` details are reported. */
  readonly blockingChecks: Readonly<Record<string, readonly string[]>>;
};

function keep(reported: Record<string, number>, name: string, value: number): void {
  reported[name] = Math.max(reported[name] ?? 0, value);
}

function isBlocking(names: readonly string[], check: string): boolean {
  return names.some((name) => check === name || check.startsWith(`${name}:`));
}

function reportChecks(
  reported: Record<string, number>,
  meta: StageMeta | null,
  blocking: Readonly<Record<string, readonly string[]>>,
): void {
  if (meta === null) return;
  for (const check of meta.checks) {
    if (isBlocking(blocking[meta.stage] ?? [], check.name)) continue;
    for (const token of check.detail.split(/\s+/)) {
      const pair = COUNT_PAIR.exec(token);
      if (pair?.[1] !== undefined && pair[2] !== undefined) {
        keep(reported, pair[1], Number(pair[2]));
      }
    }
  }
}

function templateStatus(input: StateInputs, hasFile: boolean): StateStats['template'] {
  if (!hasFile) return 'none';
  const { meta, failure, output } = input.templates;
  if (meta === null || output === null) return 'invalid';
  return failure !== null && failure.finishedAt > meta.finished_at ? 'invalid' : 'valid';
}

function stateStats(
  input: StateInputs,
  rows: AssembledRows,
  counts: Readonly<Record<string, number>>,
  ctx: CoverageInput,
): StateStats {
  const units: StateStats['units'] = {
    county: 0,
    city: 0,
    township: 0,
    school_district: 0,
    special_district: 0,
    coop: 0,
    party: 0,
  };
  for (const row of rows.jurisdictions) {
    if (row.kind !== 'state') units[row.kind] += 1;
  }
  const districts = { exact: 0, parent_fallback: 0, county_approx: 0 };
  for (const row of rows.districts) districts[row.geometry_quality] += 1;

  const electionDates = new Map(rows.elections.map((e) => [e.source_key, e]));
  const deadlineOffices = new Set<string>();
  for (const track of rows.filing_tracks) {
    const election = electionDates.get(track.election_key);
    if (track.closes_on !== null && election !== undefined && election.election_date >= ctx.today) {
      deadlineOffices.add(election.office_key);
    }
  }
  const byType: StateStats['by_office_type'] = {};
  for (const office of rows.offices) {
    const entry = (byType[office.office_type_id] ??= {
      offices: 0,
      pay_known: 0,
      deadline_known: 0,
      fee_known: 0,
      signatures_known: 0,
      where_known: 0,
      results_source: 'estimate',
      confidence: { high: 0, medium: 0, low: 0 },
    });
    entry.offices += 1;
    if (office.pay_annual_cents !== null || office.pay_amount_cents !== null) entry.pay_known += 1;
    if (deadlineOffices.has(office.source_key)) entry.deadline_known += 1;
    if (office.filing_fee_cents !== null) entry.fee_known += 1;
    if (office.signatures_required !== null) entry.signatures_known += 1;
    if (office.where_to_file !== null) entry.where_known += 1;
    for (const field of ACT_ON_OFFICE_FIELDS) {
      const meta = office.field_meta[field];
      if (meta !== undefined) entry.confidence[meta.confidence] += 1;
    }
  }

  const reported: Record<string, number> = {};
  for (const meta of [
    input.base.meta,
    input.known.meta,
    input.coops.meta,
    input.templates.meta,
    input.expand.meta,
    input.deadlines.meta,
    input.people.meta,
  ]) {
    reportChecks(reported, meta, ctx.blockingChecks);
  }
  for (const row of input.base.coverage) {
    if (!STAGE1_FIELDS.test(row.name)) keep(reported, row.name, row.value);
  }
  for (const [name, value] of Object.entries(counts)) keep(reported, name, value);

  return {
    units,
    units_with_website: input.fips === null ? 0 : (ctx.inputs.listingWebsites.get(input.fips) ?? 0),
    units_website_valid: rows.jurisdictions.filter(
      (row) => row.source_key.startsWith('census:') && row.website !== null,
    ).length,
    districts,
    offices: {
      total: rows.offices.length,
      placeholder: rows.offices.filter((office) => office.placeholder).length,
    },
    by_office_type: byType,
    template: templateStatus(input, ctx.templateStates.has(input.state)),
    rules: ctx.rules.get(input.state) ?? null,
    filing_adapter: { id: null, status: 'none', reason: 'no_adapter' },
    blocked_hosts: [...input.blockedHosts],
    ai: { units_extracted: 0, units_queued: 0, budget_exhausted: false },
    quotes_ungrounded: input.templates.quotes.filter((quote) => !quote.grounded).length,
    reported,
  };
}

/** The coverage stats of a full bundle. */
export function coverageStats(input: CoverageInput): CoverageStats {
  const states: Record<string, StateStats> = {};
  for (const state of input.inputs.states) {
    const built = input.states.find((s) => s.state === state.state);
    if (built === undefined) continue;
    states[state.state] = stateStats(state, built.rows, built.counts, input);
  }
  return CoverageStatsSchema.parse({
    version: input.version,
    generated_at: input.now.toISOString(),
    states,
    missing_states: input.inputs.missing.map((m) => m.state).sort(),
  });
}
