import { z } from 'zod';
import { LevelSchema } from '../bundle/common.ts';
import { isIssueId } from '../design/issues.ts';
import type { IssueId } from '../design/issues.ts';
import { JurisdictionKindSchema, OfficeSortSchema } from './civic.ts';
import type { JurisdictionKind, Level, OfficeSort } from './civic.ts';

// The request schemas of the `explore` area. In a query string a list is one comma-separated
// parameter and a boolean is `true` or `false`; unknown parameters are dropped.

const BooleanText = z.enum(['true', 'false']);

/** A comma list of 1 to `max` values, each one of `values` (lower snake_case words only). */
function commaListOf(values: readonly string[], max: number) {
  const one = `(${values.join('|')})`;
  return z.string().regex(new RegExp(`^${one}(,${one}){0,${String(max - 1)}}$`));
}

/** The query of `GET /v1/offices` (E-EXP-01): the filters and sorts of the office list. */
export const ListOfficesQuerySchema = z
  .object({
    scope: z.enum(['mine', 'state', 'nation']).optional(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    district: z.uuid().optional(),
    includeContained: BooleanText.optional(),
    jurisdiction: z.uuid().optional(),
    issue: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*(,[a-z0-9]+(-[a-z0-9]+)*){0,9}$/)
      .refine((list) => list.split(',').every(isIssueId), {
        params: { code: 'invalid_value' },
        message: 'An issue is not known.',
      })
      .optional(),
    level: commaListOf(LevelSchema.options, 5).optional(),
    officeType: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*(,[a-z0-9]+(-[a-z0-9]+)*){0,9}$/)
      .optional(),
    jurisdictionKind: commaListOf(JurisdictionKindSchema.options, 8).optional(),
    minPay: z.coerce.number().int().min(0).max(100_000_000).optional(),
    fitsDayJob: BooleanText.optional(),
    maxHours: z.coerce.number().int().min(1).max(80).optional(),
    deadlineWithin: z.coerce.number().int().min(1).max(365).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: OfficeSortSchema.default('opportunity'),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .meta({ id: 'ListOfficesQuery' });

export type ListOfficesQuery = z.infer<typeof ListOfficesQuerySchema>;

/** The office list query in its parsed form: lists as arrays, booleans as booleans. */
export type OfficeListQuery = {
  scope?: 'mine' | 'state' | 'nation';
  state?: string;
  district?: string;
  /** Read only with `district`; true unless the query says `false`. */
  includeContained: boolean;
  jurisdiction?: string;
  issue?: IssueId[];
  level?: Level[];
  officeType?: string[];
  jurisdictionKind?: JurisdictionKind[];
  minPay?: number;
  /** `false` is no filter. */
  fitsDayJob?: boolean;
  maxHours?: number;
  deadlineWithin?: number;
  q?: string;
  sort: OfficeSort;
  cursor?: string;
  limit: number;
};

function splitOf<T extends string>(
  list: string | undefined,
  isMember: (value: string) => value is T,
): T[] | undefined {
  return list === undefined ? undefined : list.split(',').filter(isMember);
}

function isLevel(value: string): value is Level {
  return LevelSchema.safeParse(value).success;
}

function isJurisdictionKind(value: string): value is JurisdictionKind {
  return JurisdictionKindSchema.safeParse(value).success;
}

function isText(value: string): value is string {
  return value.length > 0;
}

/** Splits the comma lists and maps `'true'` and `'false'` of a validated query (pure). */
export function parseOfficeListQuery(raw: ListOfficesQuery): OfficeListQuery {
  const issue = splitOf(raw.issue, isIssueId);
  const level = splitOf(raw.level, isLevel);
  const officeType = splitOf(raw.officeType, isText);
  const jurisdictionKind = splitOf(raw.jurisdictionKind, isJurisdictionKind);
  return {
    ...(raw.scope === undefined ? {} : { scope: raw.scope }),
    ...(raw.state === undefined ? {} : { state: raw.state }),
    ...(raw.district === undefined ? {} : { district: raw.district }),
    includeContained: raw.includeContained !== 'false',
    ...(raw.jurisdiction === undefined ? {} : { jurisdiction: raw.jurisdiction }),
    ...(issue === undefined ? {} : { issue }),
    ...(level === undefined ? {} : { level }),
    ...(officeType === undefined ? {} : { officeType }),
    ...(jurisdictionKind === undefined ? {} : { jurisdictionKind }),
    ...(raw.minPay === undefined ? {} : { minPay: raw.minPay }),
    ...(raw.fitsDayJob === undefined ? {} : { fitsDayJob: raw.fitsDayJob === 'true' }),
    ...(raw.maxHours === undefined ? {} : { maxHours: raw.maxHours }),
    ...(raw.deadlineWithin === undefined ? {} : { deadlineWithin: raw.deadlineWithin }),
    ...(raw.q === undefined ? {} : { q: raw.q }),
    sort: raw.sort,
    ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
    limit: raw.limit,
  };
}
