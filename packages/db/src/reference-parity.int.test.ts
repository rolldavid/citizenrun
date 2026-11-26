import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ISSUE_IDS, issue } from '@citizenrun/shared';
import type { IssueId } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { getTestDb } from './testing/index.ts';

// The reference rows a migration inserts must equal their authored YAML source, row for row.

const ISSUES_YAML = fileURLToPath(new URL('../../../data/issues.yaml', import.meta.url));
const POWERS_YAML = fileURLToPath(new URL('../../../data/powers.yaml', import.meta.url));
const OFFICE_TYPES_YAML = fileURLToPath(
  new URL('../../../data/office-types.yaml', import.meta.url),
);

const COLOR = /^#[0-9A-F]{6}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const IssueYamlRowSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  sort: z.int().min(1).max(19),
  icon: z.string().min(1),
  color_light: z.string().regex(COLOR),
  color_dark: z.string().regex(COLOR),
});

const IssuesYamlSchema = z
  .array(IssueYamlRowSchema)
  .length(19)
  .refine((rows) => new Set(rows.map((row) => row.sort)).size === rows.length, {
    message: 'sort values must be unique',
  });

type IssueYamlRow = z.infer<typeof IssueYamlRowSchema>;

const PowerYamlRowSchema = z.strictObject({
  id: z.string().regex(ID),
  name: z.string().min(1),
  description: z.string().min(1),
  issues: z.array(z.enum(ISSUE_IDS)).min(1),
});

const PowersYamlSchema = z.array(PowerYamlRowSchema).length(41);

const OfficeTypeYamlRowSchema = z.strictObject({
  id: z.string().regex(ID),
  name: z.string().min(1),
  level: z.enum(['local', 'county', 'state', 'federal', 'special']),
  illustration: z.string().min(1),
  electorate: z.enum(['public', 'members', 'party']),
  aliases: z.array(
    z
      .string()
      .min(1)
      .refine((alias) => alias === alias.toLowerCase(), { message: 'aliases are lower case' }),
  ),
});

const OfficeTypesYamlSchema = z.array(OfficeTypeYamlRowSchema).length(42);

type OfficeTypeYamlRow = z.infer<typeof OfficeTypeYamlRowSchema>;

// The database orders text by its collation, which ignores hyphens; both sides are compared in
// code-point order instead.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return compareText(a.id, b.id);
}

function byPowerThenIssue(
  a: { issue_id: string; power_id: string },
  b: { issue_id: string; power_id: string },
): number {
  return compareText(a.power_id, b.power_id) || compareText(a.issue_id, b.issue_id);
}

function powersYaml(): z.infer<typeof PowersYamlSchema> {
  return PowersYamlSchema.parse(parse(readFileSync(POWERS_YAML, 'utf8')));
}

function officeTypesYaml(): OfficeTypeYamlRow[] {
  return OfficeTypesYamlSchema.parse(parse(readFileSync(OFFICE_TYPES_YAML, 'utf8')));
}

function issuesYaml(): IssueYamlRow[] {
  const rows = IssuesYamlSchema.parse(parse(readFileSync(ISSUES_YAML, 'utf8')));
  return [...rows].sort((a, b) => a.sort - b.sort);
}

function isIssueId(id: string): id is IssueId {
  return (ISSUE_IDS as readonly string[]).includes(id);
}

describe('the reference rows', () => {
  it('reference rows equal the YAML', async () => {
    const stored = await getTestDb().execute<IssueYamlRow>(
      sql`select id, name, color_light, color_dark, icon, sort from issues order by sort`,
      'objects',
    );
    expect(stored).toEqual(issuesYaml());
  });

  it('issue colors equal the design tokens', () => {
    for (const row of issuesYaml()) {
      if (!isIssueId(row.id)) {
        throw new Error(`The YAML issue id ${row.id} is not in ISSUE_IDS.`);
      }
      expect({ id: row.id, light: row.color_light, dark: row.color_dark }).toEqual({
        id: row.id,
        light: issue[row.id].light,
        dark: issue[row.id].dark,
      });
    }
  });

  it('issue ids equal the shared list', () => {
    expect(issuesYaml().map((row) => row.id)).toEqual([...ISSUE_IDS]);
  });

  it('powers equal the YAML', async () => {
    const stored = await getTestDb().execute<{ id: string; name: string; description: string }>(
      sql`select id, name, description from powers order by id`,
      'objects',
    );
    const expected = powersYaml()
      .map(({ id, name, description }) => ({ id, name, description }))
      .sort(byId);
    expect([...stored].sort(byId)).toEqual(expected);
  });

  it('issue links equal the YAML', async () => {
    const stored = await getTestDb().execute<{ issue_id: string; power_id: string }>(
      sql`select issue_id, power_id from issue_powers order by power_id, issue_id`,
      'objects',
    );
    const expected = powersYaml()
      .flatMap((power) =>
        power.issues.map((issueId) => ({ issue_id: issueId, power_id: power.id })),
      )
      .sort(byPowerThenIssue);
    expect([...stored].sort(byPowerThenIssue)).toEqual(expected);
  });

  it('office types equal the YAML', async () => {
    const stored = await getTestDb().execute<OfficeTypeYamlRow>(
      sql`select id, name, level, illustration, electorate, aliases from office_types order by id`,
      'objects',
    );
    expect([...stored].sort(byId)).toEqual([...officeTypesYaml()].sort(byId));
  });

  it('icon is the id', () => {
    for (const row of issuesYaml()) {
      expect(row.icon).toBe(row.id);
    }
  });
});
