import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { repoRoot } from '../lib/paths.ts';
import { loadReferenceIds } from '../stages/shared/reference.ts';
import { ZZ_RULES } from './__fixtures__/zz-rules.ts';
import { WA_EXAMPLE_RULES } from './__fixtures__/zz-wa-rules.ts';
import { fillWaExample } from './__fixtures__/zz-wa-worked-example.values.ts';
import type { TemplateError } from './errors.ts';
import { STATES_WITHOUT_SLDL, templateOfficeEntries, validateTemplateText } from './validate.ts';
import type { ValidateContext } from './validate.ts';

const FIXTURES = join(import.meta.dirname, '__fixtures__');

let reference: { officeTypeIds: ReadonlySet<string>; powerIds: ReadonlySet<string> };
let waText: string;
let zzText: string;

beforeAll(async () => {
  reference = await loadReferenceIds(repoRoot());
  waText = await readFile(join(FIXTURES, 'zz-wa-worked-example.yaml'), 'utf8');
  zzText = await readFile(join(FIXTURES, 'zz-template.yaml'), 'utf8');
});

function waContext(overrides: Partial<ValidateContext> = {}): ValidateContext {
  return { state: 'WA', ...reference, rules: WA_EXAMPLE_RULES, isFixture: true, ...overrides };
}

function zzContext(overrides: Partial<ValidateContext> = {}): ValidateContext {
  return { state: 'ZZ', ...reference, rules: ZZ_RULES, isFixture: true, ...overrides };
}

function errorsOf(text: string, ctx: ValidateContext): readonly TemplateError[] {
  const result = validateTemplateText(text, ctx);
  return result.ok ? [] : result.errors;
}

function paths(text: string, ctx: ValidateContext): readonly string[] {
  return errorsOf(text, ctx).map((error) => error.path);
}

type Mutable = Record<string, unknown>;

/** A copy of the ZZ fixture template with one change made to its parsed form. */
function brokenZz(change: (t: Mutable) => void): string {
  const template = parse(zzText) as Mutable; // the fixture parses to a mapping
  change(template);
  return stringify(template);
}

function at(value: unknown, ...keys: (string | number)[]): Mutable {
  let node: unknown = value;
  for (const key of keys) {
    node = (node as Record<string | number, unknown>)[key]; // a path into the fixture known to exist
  }
  return node as Mutable; // a mapping of the fixture
}

describe('validateTemplateText', () => {
  it('the worked Washington example validates once its placeholders are replaced', () => {
    const result = validateTemplateText(fillWaExample(waText), waContext());
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('the worked example with its placeholders is refused outside the fixtures folder', () => {
    const lines = waText.split('\n');
    const expected = lines.flatMap((line, index) =>
      line.includes('<<placeholder') ? [`line ${String(index + 1)}`] : [],
    );
    expect(expected.length).toBeGreaterThan(10);
    const errors = errorsOf(waText, waContext({ isFixture: false }));
    expect(errors.map((error) => error.path)).toEqual(expected);
    expect(errors.every((error) => error.message === 'placeholder')).toBe(true);
  });

  it('an unknown power id fails with its path', () => {
    const text = fillWaExample(waText).replace(
      'powers: []',
      'powers: [{ power: no-such-power, relevance: 2, source_url: https://example.test/wa/p, quote: "Fixture text: p.", citation: "Fixture RCW p" }]',
    );
    const found = paths(text, waContext());
    expect(found).toEqual(['government_types.0.offices.0.powers.0.power']);
    expect(found[0]?.endsWith('powers.0.power')).toBe(true);
  });

  it('a relevance of 4 fails with its path', () => {
    const text = fillWaExample(waText).replace(
      'powers: []',
      'powers: [{ power: zoning-land-use, relevance: 4, source_url: https://example.test/wa/p, quote: "Fixture text: p.", citation: "Fixture RCW p" }]',
    );
    const errors = errorsOf(text, waContext());
    expect(errors.map((error) => error.path)).toEqual([
      'government_types.0.offices.0.powers.0.relevance',
    ]);
    expect(errors[0]?.message).not.toContain('4');
  });

  it('a missing quote fails with its path', () => {
    const filled = fillWaExample(waText);
    const quote = ', quote: "Fixture text: commissioners serve terms of four years."';
    expect(filled).toContain(quote);
    const found = paths(filled.replace(quote, ''), waContext());
    expect(found).toEqual(['government_types.0.offices.0.term_years.quote']);
  });

  it('the ZZ fixture template is valid with the ZZ rules', () => {
    const result = validateTemplateText(zzText, zzContext());
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('the ZZ fixture template is valid outside the fixtures folder, having no placeholder', () => {
    expect(validateTemplateText(zzText, zzContext({ isFixture: false })).ok).toBe(true);
  });

  it('rule 1: an unknown office type fails at its path', () => {
    const text = brokenZz((t) => {
      at(t, 'government_types', 0, 'offices', 1).office_type = 'no-such-type';
    });
    expect(paths(text, zzContext())).toEqual(['government_types.0.offices.1.office_type']);
  });

  it('rule 2: a schedule the rules module does not export fails at its path', () => {
    const text = brokenZz((t) => {
      at(t, 'statewide', 0).schedule = 'zz_missing';
    });
    expect(paths(text, zzContext())).toEqual(['statewide.0.schedule']);
  });

  it('rule 2: a state with no registered rules module fails at rules_module', () => {
    const errors = errorsOf(zzText, zzContext({ rules: null }));
    expect(errors).toEqual([
      { path: 'rules_module', message: 'no rules module registered for ZZ' },
    ]);
  });

  it('rule 2: a template of another state fails at state and rules_module', () => {
    expect(paths(zzText, zzContext({ state: 'ZY' }))).toEqual(['state', 'rules_module']);
  });

  it('rule 3: a by_district office without label_pattern fails at its path', () => {
    const text = brokenZz((t) => {
      at(t, 'government_types', 1, 'offices', 0, 'seats').label_pattern = null;
    });
    expect(paths(text, zzContext())).toEqual(['government_types.1.offices.0.seats.label_pattern']);
  });

  it('rule 4: stagger seats of 3 and 1 against a body of 5 fail at the stagger', () => {
    const text = brokenZz((t) => {
      at(t, 'government_types', 0, 'offices', 0, 'stagger', 1).seats = 1;
    });
    expect(paths(text, zzContext())).toEqual(['government_types.0.offices.0.stagger']);
  });

  it('rule 4: a staggered office without body_size fails at body_size', () => {
    const text = brokenZz((t) => {
      at(t, 'government_types', 0, 'offices', 0).body_size = null;
    });
    expect(paths(text, zzContext())).toEqual(['government_types.0.offices.0.body_size']);
  });

  it('rule 5: a duplicate office key fails at the second key', () => {
    const text = brokenZz((t) => {
      at(t, 'government_types', 0, 'offices', 1).key = 'county-commissioner';
    });
    expect(paths(text, zzContext())).toEqual(['government_types.0.offices.1.key']);
  });

  it('rule 5: a county union no set defines fails at its path', () => {
    const text = brokenZz((t) => {
      at(t, 'statewide', 2, 'district').county_union = 'west';
    });
    expect(paths(text, zzContext())).toEqual(['statewide.2.district.county_union']);
  });

  it('rule 5: a duplicate county set id fails at its path', () => {
    const text = brokenZz((t) => {
      const sets = t['county_sets'] as unknown[]; // the fixture's list of sets
      sets.push({ ...at(t, 'county_sets', 0) });
    });
    expect(paths(text, zzContext())).toEqual(['county_sets.1.id']);
  });

  it('rule 6: a statewide treasurer without wikidata_position fails at its path', () => {
    const text = brokenZz((t) => {
      at(t, 'statewide', 1).wikidata_position = null;
    });
    expect(paths(text, zzContext())).toEqual(['statewide.1.wikidata_position']);
  });

  it('rule 6: a lieutenant governor and a pension board need no wikidata_position', () => {
    const text = brokenZz((t) => {
      const treasurer = at(t, 'statewide', 1);
      treasurer.office_type = 'statewide-executive-other';
      treasurer.title = 'Lieutenant Governor';
      treasurer.wikidata_position = null;
      const judge = at(t, 'statewide', 2);
      judge.office_type = 'pension-board';
      judge.wikidata_position = null;
    });
    expect(paths(text, zzContext())).toEqual([]);
  });

  it('rule 7: a placeholder left in a fixture fails at its path', () => {
    const text = brokenZz((t) => {
      t.name = 'Fixture <<placeholder: x>>';
    });
    const errors = errorsOf(text, zzContext({ isFixture: true }));
    expect(errors).toEqual([{ path: 'name', message: 'placeholder' }]);
  });

  it('rule 8: an unelected special-district block with an office fails at its offices', () => {
    const text = brokenZz((t) => {
      const fire = at(t, 'special_districts', 0, 'offices', 0);
      (at(t, 'special_districts', 1).offices as unknown[]).push({ ...fire, key: 'water-board' });
    });
    expect(paths(text, zzContext())).toEqual(['special_districts.1.offices']);
  });

  it('rule 9: a state-house entry for NE fails at its path', () => {
    expect(STATES_WITHOUT_SLDL.has('NE')).toBe(true);
    const text = brokenZz((t) => {
      t.state = 'NE';
      t.rules_module = 'ne';
    });
    expect(paths(text, zzContext({ state: 'NE' }))).toEqual(['legislature.1']);
  });

  it('rule 9: a state with an SLDL layer needs one state-house entry', () => {
    const text = brokenZz((t) => {
      (t['legislature'] as unknown[]).pop();
    });
    expect(paths(text, zzContext())).toEqual(['legislature']);
  });

  it('a parse error is reported by line with no value', () => {
    const errors = errorsOf('schema_version: 1\nstate: [ZZ\n', zzContext());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => /^line \d+$/.test(error.path))).toBe(true);
  });

  it('lists every office entry with its path, scope and owner', () => {
    const result = validateTemplateText(zzText, zzContext());
    if (!result.ok) {
      throw new Error('the fixture template must validate');
    }
    expect(
      templateOfficeEntries(result.template).map(({ path, entry, scope, ownerKey }) => [
        path,
        entry.key,
        scope,
        ownerKey,
      ]),
    ).toEqual([
      ['government_types.0.offices.0', 'county-commissioner', 'government_type', 'county'],
      ['government_types.0.offices.1', 'sheriff', 'government_type', 'county'],
      ['government_types.1.offices.0', 'city-council', 'government_type', 'city'],
      ['special_districts.0.offices.0', 'fire-board', 'special_district', 'fire-district'],
      ['statewide.0', 'governor', 'statewide', 'statewide'],
      ['statewide.1', 'treasurer', 'statewide', 'statewide'],
      ['statewide.2', 'trial-judge-east', 'statewide', 'statewide'],
      ['party_committee.offices.0', 'precinct-committee', 'party_committee', 'party_committee'],
    ]);
  });
});
