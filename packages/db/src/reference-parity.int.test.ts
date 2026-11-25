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

const COLOR = /^#[0-9A-F]{6}$/;

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

  it('icon is the id', () => {
    for (const row of issuesYaml()) {
      expect(row.icon).toBe(row.id);
    }
  });
});
