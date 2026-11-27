import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  REGISTER_FILES,
  SnapshotSourcesFileSchema,
  SourcesFileSchema,
  TimezonesFileSchema,
  UnitOverrideSchema,
  hasMarker,
  loadBoundarySources,
  loadCoopEinOverrides,
  loadCountyNameOverrides,
  loadNicknameSupplement,
  loadParties,
  loadPhotoTerms,
  loadRegistries,
  loadSnapshotSources,
  loadSources,
  loadTimezones,
  loadUnitOverrides,
  sourceHostRules,
} from './data-files.ts';
import { DataFileError, parseYamlWith } from './yaml.ts';

function problemsOf<T>(text: string, schema: z.ZodType<T>): readonly string[] {
  try {
    parseYamlWith(text, 'data/fixture.yaml', schema);
  } catch (error) {
    if (error instanceof DataFileError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

/** One fixture source entry as YAML lines, with `overrides` replacing whole lines by key. */
function sourceYaml(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    id: 'fixture-dataset',
    kind: 'dataset',
    name: 'Fixture dataset',
    publisher: 'Fixture publisher',
    url: 'https://example.com/fixture.csv',
    terms_url: 'https://example.com/terms',
    terms_read_on: '2026-11-20',
    basis: 'Fixture basis.',
    licence_spdx: 'CC0-1.0',
    attribution: 'null',
    robots_checked_on: '2026-11-20',
    ci_status: 'unknown',
    notes: 'null',
    ...overrides,
  };
  return Object.entries(fields)
    .map(([key, value], i) => `${i === 0 ? '- ' : '  '}${key}: ${value}`)
    .join('\n');
}

function snapshotYaml(recipe: string, extra = ''): string {
  return `- source: zz-fixture\n  state: ZZ\n  always: true\n${extra}  recipe:\n${recipe}`;
}

describe('the register files', () => {
  it('every register file in data/ validates', async () => {
    const loaded = await Promise.all([
      loadSources(),
      loadPhotoTerms(),
      loadBoundarySources(),
      loadRegistries(),
      loadCoopEinOverrides(),
      loadCountyNameOverrides(),
      loadUnitOverrides(),
      loadNicknameSupplement(),
      loadSnapshotSources(),
      loadTimezones(),
      loadParties(),
    ]);
    expect(loaded).toHaveLength(Object.keys(REGISTER_FILES).length);
    const [sources, , , , , , , nicknames, snapshots, timezones, parties] = loaded;
    expect(sources.length).toBeGreaterThan(30);
    expect(Object.isFrozen(sources)).toBe(true);
    expect(Object.isFrozen(sources[0])).toBe(true);
    expect(nicknames).toEqual([
      { canonical: 'jose', alias: 'pepe', note: 'Spanish hypocorism' },
      { canonical: 'francisco', alias: 'paco', note: 'Spanish hypocorism' },
    ]);
    expect(timezones.map((entry) => entry.state).sort()).toEqual(['LA', 'NC', 'TX', 'VA', 'WA']);
    expect(Object.keys(parties.aliases)).toContain('independent');
    // A window read from the file stays a calendar date string.
    const tx = snapshots.find((entry) => entry.source === 'tx-2027-05-01');
    expect(tx?.windows?.[0]).toEqual({ from: '2027-01-13', to: '2027-02-12' });
  });

  it('every snapshot source has a sources entry of kind adapter', async () => {
    const sources = await loadSources();
    const snapshots = await loadSnapshotSources();
    const kinds = new Map(sources.map((entry) => [entry.id, entry.kind]));
    for (const entry of snapshots) {
      expect(kinds.get(entry.source)).toBe('adapter');
    }
    expect(snapshots.some((entry) => entry.state === 'IL')).toBe(false);
  });

  it('records ci_status unknown everywhere and no results host', async () => {
    const sources = await loadSources();
    expect(sources.every((entry) => entry.ci_status === 'unknown')).toBe(true);
    expect(sources.filter((entry) => entry.forbidden)).toHaveLength(6);
    expect(sources.some((entry) => entry.results_host)).toBe(false);
  });
});

describe('SourcesFileSchema', () => {
  it('accepts the fixture entry', () => {
    expect(problemsOf(sourceYaml(), SourcesFileSchema)).toEqual([]);
  });

  it('an unknown key is refused with its YAML path and line', () => {
    const text = `${sourceYaml()}\n  notes2: something private`;
    const problems = problemsOf(text, SourcesFileSchema);
    expect(problems).toEqual([
      expect.stringMatching(/^data\/fixture\.yaml: \[0\]\.notes2 \(line 14\): /),
    ]);
    expect(problems[0]).not.toContain('something private');
  });

  it('a duplicate source id is refused', () => {
    const problems = problemsOf(`${sourceYaml()}\n${sourceYaml()}`, SourcesFileSchema);
    expect(problems).toEqual([
      expect.stringMatching(/\[1\]\.id \(line 14\): duplicate source id$/),
    ]);
  });

  it('a non-forbidden dataset without terms is refused', () => {
    const problems = problemsOf(
      sourceYaml({ terms_url: 'null', terms_read_on: 'null' }),
      SourcesFileSchema,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/\[0\]\.terms_url \(line 6\): /);
    expect(problems[1]).toMatch(/\[0\]\.terms_read_on \(line 7\): /);
    // The same entry marked forbidden needs no terms.
    expect(
      problemsOf(
        `${sourceYaml({ terms_url: 'null', terms_read_on: 'null', robots_checked_on: 'null' })}\n  forbidden: true`,
        SourcesFileSchema,
      ),
    ).toEqual([]);
  });

  it('a challenged adapter may leave its terms null', () => {
    const challenged = {
      kind: 'adapter',
      terms_url: 'null',
      terms_read_on: 'null',
      robots_checked_on: '2026-11-20',
      notes: 'Host challenged the check on 2026-11-20. Its terms were not read.',
    };
    expect(problemsOf(sourceYaml(challenged), SourcesFileSchema)).toEqual([]);
    const other = problemsOf(
      sourceYaml({ ...challenged, notes: 'The host was slow on 2026-11-20.' }),
      SourcesFileSchema,
    );
    expect(other).toHaveLength(2);
    // The robots date must be the day the notes give.
    expect(
      problemsOf(sourceYaml({ ...challenged, robots_checked_on: '2026-11-21' }), SourcesFileSchema),
    ).toEqual([expect.stringMatching(/\[0\]\.robots_checked_on \(line 11\): /)]);
    // A dataset cannot use the challenged form.
    expect(
      problemsOf(sourceYaml({ ...challenged, kind: 'dataset' }), SourcesFileSchema),
    ).toHaveLength(2);
  });

  it('refuses a host name that is not lower-case', () => {
    const problems = problemsOf(`${sourceYaml()}\n  hosts: [Example.com]`, SourcesFileSchema);
    expect(problems).toEqual([expect.stringMatching(/\[0\]\.hosts\[0\] \(line 14\): /)]);
  });

  it('refuses an http url', () => {
    const problems = problemsOf(
      sourceYaml({ url: 'http://example.com/fixture.csv' }),
      SourcesFileSchema,
    );
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem).toMatch(/^data\/fixture\.yaml: \[0\]\.url \(line 5\): /);
    }
  });
});

describe('sourceHostRules', () => {
  it('sourceHostRules lists the forbidden hosts', async () => {
    const rules = sourceHostRules(await loadSources());
    expect(rules.forbiddenHosts).toContain('ballotpedia.org');
    expect(rules.forbiddenHosts).toContain('www.ncsl.org');
    expect(rules.forbiddenHosts).toContain('elections.il.gov');
    expect(rules.forbiddenHosts).not.toContain('www2.census.gov');
    expect(rules.resultsHosts).toEqual([]);
  });

  it('takes the host of the url when an entry gives no hosts', () => {
    const entries = parseYamlWith(
      `${sourceYaml()}\n  forbidden: true\n  results_host: true`,
      'data/fixture.yaml',
      SourcesFileSchema,
    );
    expect(sourceHostRules(entries)).toEqual({
      forbiddenHosts: ['example.com'],
      resultsHosts: ['example.com'],
    });
  });
});

describe('SnapshotSourcesFileSchema', () => {
  it('a marker is accepted in a snapshot recipe and hasMarker sees it', () => {
    const marked = parseYamlWith(
      snapshotYaml("    kind: get\n    url: '<recorded at build>'\n"),
      'data/fixture.yaml',
      SnapshotSourcesFileSchema,
    );
    expect(marked[0] !== undefined && hasMarker(marked[0])).toBe(true);
    const plain = parseYamlWith(
      snapshotYaml('    kind: get\n    url: https://example.com/list.csv\n'),
      'data/fixture.yaml',
      SnapshotSourcesFileSchema,
    );
    expect(plain[0] !== undefined && hasMarker(plain[0])).toBe(false);
  });

  it('a playwright_export recipe may give election_select', () => {
    const recipe = (select: string) =>
      snapshotYaml(
        `    kind: playwright_export\n    url: https://example.com/list?e={election_id}\n    election_ids_from: https://example.com/list\n    election_select: '${select}'\n    export_button_text: Export to CSV\n`,
      );
    const parsed = parseYamlWith(
      recipe('#ddlElections'),
      'data/fixture.yaml',
      SnapshotSourcesFileSchema,
    );
    expect(parsed[0]?.recipe).toMatchObject({
      kind: 'playwright_export',
      election_select: '#ddlElections',
    });
    const problems = problemsOf(recipe('x'.repeat(201)), SnapshotSourcesFileSchema);
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem).toMatch(/^data\/fixture\.yaml: \[0\]\.recipe\.election_select \(line 8\): /);
      expect(problem).not.toContain('xxxx');
    }
  });

  it('a recipe URL that is http is refused', () => {
    const problems = problemsOf(
      snapshotYaml('    kind: get\n    url: http://example.com/list.csv\n'),
      SnapshotSourcesFileSchema,
    );
    expect(problems).toEqual([expect.stringMatching(/\[0\]\.recipe\.url \(line 6\): /)]);
  });

  it('a link pattern must compile', () => {
    const problems = problemsOf(
      snapshotYaml(
        "    kind: discover_get\n    page: https://example.com/\n    link_pattern: 'List_(\\d{4}.csv'\n",
      ),
      SnapshotSourcesFileSchema,
    );
    expect(problems).toEqual([expect.stringMatching(/\[0\]\.recipe\.link_pattern \(line 7\): /)]);
  });

  it('always false needs a window', () => {
    const text =
      '- source: zz-fixture\n  state: ZZ\n  always: false\n  recipe:\n    kind: get\n    url: https://example.com/a.csv\n';
    expect(problemsOf(text, SnapshotSourcesFileSchema)).toEqual([
      expect.stringMatching(
        /\[0\]\.windows \(line 1\): an entry that is not always needs a window$/,
      ),
    ]);
    const windowed = text.replace(
      '  recipe:',
      '  windows: [{ from: 2027-01-13, to: 2027-02-12 }]\n  recipe:',
    );
    expect(problemsOf(windowed, SnapshotSourcesFileSchema)).toEqual([]);
    const backwards = text.replace(
      '  recipe:',
      '  windows: [{ from: 2027-02-12, to: 2027-01-13 }]\n  recipe:',
    );
    expect(problemsOf(backwards, SnapshotSourcesFileSchema)).toEqual([
      expect.stringMatching(/\[0\]\.windows\[0\] \(line 4\): a window ends before it starts$/),
    ]);
  });
});

describe('TimezonesFileSchema', () => {
  const entry = (state: string, overrides: string, zone = 'America/Chicago') =>
    `- state: ${state}\n  default: ${zone}\n  county_overrides: ${overrides}\n  source_url: https://example.com/cfr\n  quote: Fixture quote.\n  citation: Fixture citation\n`;

  it('accepts an entry with an override in its state', () => {
    expect(
      problemsOf(
        entry('TX', "[{ county_geoid: '48141', zone: America/Denver }]"),
        TimezonesFileSchema,
      ),
    ).toEqual([]);
  });

  it('an override county outside its state is refused', () => {
    expect(
      problemsOf(
        entry('TX', "[{ county_geoid: '37183', zone: America/Denver }]"),
        TimezonesFileSchema,
      ),
    ).toEqual([
      expect.stringMatching(
        /\[0\]\.county_overrides\[0\]\.county_geoid \(line 3\): the county is outside the entry state$/,
      ),
    ]);
  });

  it('an invalid IANA zone is refused', () => {
    expect(problemsOf(entry('TX', '[]', 'America/Nowhere'), TimezonesFileSchema)).toEqual([
      expect.stringMatching(/\[0\]\.default \(line 2\): not an IANA time zone$/),
    ]);
  });

  it('a zone outside US_ZONE_NAMES is refused', () => {
    expect(problemsOf(entry('TX', '[]', 'Europe/Paris'), TimezonesFileSchema)).toEqual([
      expect.stringMatching(/\[0\]\.default \(line 2\): not a zone of US_ZONE_NAMES$/),
    ]);
  });

  it('an override that repeats the default is refused', () => {
    expect(
      problemsOf(
        entry('TX', "[{ county_geoid: '48201', zone: America/Chicago }]"),
        TimezonesFileSchema,
      ),
    ).toEqual([expect.stringMatching(/\[0\]\.county_overrides\[0\]\.zone \(line 3\): /)]);
  });
});

describe('UnitOverrideSchema', () => {
  it('accepts a five-digit fips_place alone and refuses any other form', () => {
    const base = { pid6: '990001', reason: 'TIGER 2026 has the unit under another place code.' };
    expect(UnitOverrideSchema.safeParse({ ...base, fips_place: '71550' }).success).toBe(true);
    expect(UnitOverrideSchema.safeParse({ ...base, fips_place: '1571550' }).success).toBe(false);
    expect(UnitOverrideSchema.safeParse({ ...base, fips_place: '7155' }).success).toBe(false);
    expect(UnitOverrideSchema.safeParse(base).success).toBe(false);
  });
});
