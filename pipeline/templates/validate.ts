// The template validator: the shape of PIPE-template-schema and the nine rules beyond it. Every
// error carries the YAML path and a fixed message, never a value from the file.
import type { StateRules } from '@citizenrun/rules';
import { DataFileError, parseYaml } from '../lib/yaml.ts';
import { joinPath } from './errors.ts';
import type { TemplateError } from './errors.ts';
import { StateTemplateSchema } from './schema.ts';
import type { OfficeEntry, StateTemplate } from './schema.ts';

export type ValidateContext = {
  readonly state: string; // 'NC'; from the file name data/templates/<st>.yaml
  readonly officeTypeIds: ReadonlySet<string>; // data/office-types.yaml
  readonly powerIds: ReadonlySet<string>; // data/powers.yaml
  readonly rules: StateRules | null; // rulesFor(state) in the stage; a fixture module in tests
  readonly isFixture: boolean; // true only for files under pipeline/templates/__fixtures__/
};

export type ValidateResult =
  | { readonly ok: true; readonly template: StateTemplate }
  | { readonly ok: false; readonly errors: readonly TemplateError[] };

/** States whose TIGER edition has no SLDL layer, so their template has no state-house entry. */
export const STATES_WITHOUT_SLDL: ReadonlySet<string> = new Set(['DC', 'NE']);

const PLACEHOLDER = '<<placeholder';

/** The executive offices Open States lists, which need no Wikidata position (D-315). */
const OPEN_STATES_EXECUTIVES: ReadonlySet<string> = new Set([
  'governor',
  'secretary-of-state',
  'attorney-general',
]);
const LIEUTENANT_GOVERNOR = /lieutenant governor/i;

export type TemplateOfficeScope =
  'government_type' | 'special_district' | 'statewide' | 'party_committee';

/**
 * Every office entry of the template with its YAML path, its scope and the key of the government
 * type or special-district block that holds it (`statewide` and `party_committee` for those lists).
 */
export function templateOfficeEntries(template: StateTemplate): readonly {
  path: string;
  entry: OfficeEntry;
  scope: TemplateOfficeScope;
  ownerKey: string;
}[] {
  const out: { path: string; entry: OfficeEntry; scope: TemplateOfficeScope; ownerKey: string }[] =
    [];
  template.government_types.forEach((type, i) => {
    type.offices.forEach((entry, j) => {
      out.push({
        path: `government_types.${String(i)}.offices.${String(j)}`,
        entry,
        scope: 'government_type',
        ownerKey: type.key,
      });
    });
  });
  template.special_districts.forEach((block, i) => {
    block.offices.forEach((entry, j) => {
      out.push({
        path: `special_districts.${String(i)}.offices.${String(j)}`,
        entry,
        scope: 'special_district',
        ownerKey: block.key,
      });
    });
  });
  template.statewide.forEach((entry, i) => {
    out.push({ path: `statewide.${String(i)}`, entry, scope: 'statewide', ownerKey: 'statewide' });
  });
  template.party_committee.offices.forEach((entry, j) => {
    out.push({
      path: `party_committee.offices.${String(j)}`,
      entry,
      scope: 'party_committee',
      ownerKey: 'party_committee',
    });
  });
  return out;
}

function placeholderLines(text: string): TemplateError[] {
  const errors: TemplateError[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(PLACEHOLDER)) {
      errors.push({ path: `line ${String(index + 1)}`, message: 'placeholder' });
    }
  });
  return errors;
}

const PROBLEM_LINE = /: line (\d+): (.+)$/;

function parseErrors(error: DataFileError): TemplateError[] {
  return error.problems.map((problem) => {
    const match = PROBLEM_LINE.exec(problem);
    return match === null
      ? { path: 'line 1', message: 'the file does not parse' }
      : { path: `line ${match[1] ?? '1'}`, message: match[2] ?? 'the file does not parse' };
  });
}

function stringPaths(
  value: unknown,
  path: readonly string[],
  out: { path: string; text: string }[],
): void {
  if (typeof value === 'string') {
    out.push({ path: path.join('.'), text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      stringPaths(item, [...path, String(index)], out);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      stringPaths(child, [...path, key], out);
    }
  }
}

/** The nine rules beyond the shape, in order; every error of every rule is returned. */
function ruleErrors(template: StateTemplate, ctx: ValidateContext): TemplateError[] {
  const errors: TemplateError[] = [];
  const offices = templateOfficeEntries(template);
  const chambers = template.legislature.map((entry, i) => ({
    path: `legislature.${String(i)}`,
    entry,
  }));

  // Rule 1: office types and powers exist.
  for (const { path, entry } of [...offices, ...chambers]) {
    if (!ctx.officeTypeIds.has(entry.office_type)) {
      errors.push({ path: `${path}.office_type`, message: 'unknown office type' });
    }
    entry.powers.forEach((power, j) => {
      if (!ctx.powerIds.has(power.power)) {
        errors.push({ path: `${path}.powers.${String(j)}.power`, message: 'unknown power' });
      }
    });
  }

  // Rule 2: the file is the state's, names the state's module, and uses only its ids.
  if (template.state !== ctx.state) {
    errors.push({ path: 'state', message: 'the state differs from the file name' });
  }
  if (template.rules_module !== ctx.state.toLowerCase()) {
    errors.push({ path: 'rules_module', message: "the rules module is not the state's" });
  }
  if (ctx.rules === null) {
    errors.push({ path: 'rules_module', message: `no rules module registered for ${ctx.state}` });
  } else {
    const schedules = new Set(ctx.rules.schedules);
    const trackSets = new Set(ctx.rules.trackSets);
    const scheduled = [
      ...offices.map(({ path, entry }) => ({ path, entry })),
      ...chambers,
      { path: 'federal.us_house', entry: template.federal.us_house },
      { path: 'federal.us_senate', entry: template.federal.us_senate },
    ];
    for (const { path, entry } of scheduled) {
      if (!schedules.has(entry.schedule)) {
        errors.push({
          path: `${path}.schedule`,
          message: 'the rules module exports no such schedule',
        });
      }
      if (!trackSets.has(entry.track_set)) {
        errors.push({
          path: `${path}.track_set`,
          message: 'the rules module exports no such track set',
        });
      }
    }
  }

  // Rules 3 and 4: seats, and staggered groups against the body size.
  for (const { path, entry } of offices) {
    const { arrangement, count, district_count: districtCount, label_pattern: label } = entry.seats;
    if ((arrangement === 'at_large' || arrangement === 'mixed') && count === null) {
      errors.push({ path: `${path}.seats.count`, message: `${arrangement} needs count` });
    }
    if ((arrangement === 'by_district' || arrangement === 'mixed') && districtCount === null) {
      errors.push({
        path: `${path}.seats.district_count`,
        message: `${arrangement} needs district_count`,
      });
    }
    if ((arrangement === 'by_district' || arrangement === 'mixed') && label === null) {
      errors.push({
        path: `${path}.seats.label_pattern`,
        message: `${arrangement} needs label_pattern`,
      });
    }
  }
  for (const { path, entry } of offices) {
    if (entry.stagger.length === 0) {
      continue;
    }
    if (entry.body_size === null) {
      errors.push({ path: `${path}.body_size`, message: 'a staggered office needs body_size' });
      continue;
    }
    const seats = entry.stagger.reduce((sum, group) => sum + group.seats, 0);
    if (seats !== entry.body_size.value) {
      errors.push({
        path: `${path}.stagger`,
        message: "the stagger groups' seats differ from body_size",
      });
    }
  }

  // Rule 5: unique office keys and county sets; every county union names a set.
  const seenKeys = new Set<string>();
  for (const { path, entry } of offices) {
    if (seenKeys.has(entry.key)) {
      errors.push({ path: `${path}.key`, message: 'duplicate office key' });
    }
    seenKeys.add(entry.key);
  }
  const setIds = new Set<string>();
  template.county_sets.forEach((set, i) => {
    if (setIds.has(set.id)) {
      errors.push({ path: `county_sets.${String(i)}.id`, message: 'duplicate county set id' });
    }
    setIds.add(set.id);
  });
  for (const { path, entry } of offices) {
    if (entry.district !== null && !setIds.has(entry.district.county_union)) {
      errors.push({ path: `${path}.district.county_union`, message: 'no county set has this id' });
    }
  }

  // Rule 6: statewide holders have a source (D-315).
  template.statewide.forEach((entry, i) => {
    const exempt =
      entry.wikidata_position !== null ||
      OPEN_STATES_EXECUTIVES.has(entry.office_type) ||
      (entry.office_type === 'statewide-executive-other' &&
        LIEUTENANT_GOVERNOR.test(entry.title)) ||
      entry.office_type === 'pension-board';
    if (!exempt) {
      errors.push({
        path: `statewide.${String(i)}.wikidata_position`,
        message: 'a statewide office needs wikidata_position',
      });
    }
  });

  // Rule 7: no value holds a placeholder.
  const strings: { path: string; text: string }[] = [];
  stringPaths(template, [], strings);
  for (const { path, text } of strings) {
    if (text.includes(PLACEHOLDER)) {
      errors.push({ path, message: 'placeholder' });
    }
  }

  // Rule 8: an unelected special-district kind creates no office.
  template.special_districts.forEach((block, i) => {
    if (!block.elected.value && block.offices.length > 0) {
      errors.push({
        path: `special_districts.${String(i)}.offices`,
        message: 'an unelected special-district block has no offices',
      });
    }
  });

  // Rule 9: one senate entry, and one house entry where TIGER has an SLDL layer.
  const senates = chambers.filter(({ entry }) => entry.office_type === 'state-senate');
  const houses = chambers.filter(({ entry }) => entry.office_type === 'state-house');
  if (senates.length !== 1) {
    errors.push({
      path: 'legislature',
      message: 'legislature needs exactly one state-senate entry',
    });
  }
  if (STATES_WITHOUT_SLDL.has(ctx.state)) {
    for (const { path } of houses) {
      errors.push({ path, message: 'the state has no SLDL layer, so no state-house entry' });
    }
  } else if (houses.length !== 1) {
    errors.push({
      path: 'legislature',
      message: 'legislature needs exactly one state-house entry',
    });
  }

  return errors;
}

/**
 * Validates a template's text: the placeholder scan (outside fixtures), the parse, the shape, then
 * the nine rules. Each step's errors are all collected before stopping at the end of that step.
 */
export function validateTemplateText(text: string, ctx: ValidateContext): ValidateResult {
  if (!ctx.isFixture) {
    const placeholders = placeholderLines(text);
    if (placeholders.length > 0) {
      return { ok: false, errors: placeholders };
    }
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text, 'template');
  } catch (error) {
    if (error instanceof DataFileError) {
      return { ok: false, errors: parseErrors(error) };
    }
    throw error;
  }

  const shape = StateTemplateSchema.safeParse(parsed);
  if (!shape.success) {
    return {
      ok: false,
      errors: shape.error.issues.map((issue) => ({
        path: joinPath(issue.path),
        message: issue.message,
      })),
    };
  }

  const errors = ruleErrors(shape.data, ctx);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, template: shape.data };
}
