// Matching a unit to the template's government types and special-district blocks (PIPE-expand
// step 1), and the template's regular expressions, compiled case-insensitively.
import type { StateTemplate } from '../../templates/schema.ts';
import type { ExpandUnit } from './units.ts';

export type UnitMatch =
  | { readonly kind: 'government_type'; readonly index: number }
  | { readonly kind: 'special_district'; readonly index: number }
  | { readonly kind: 'none' };

/** A template regular expression that does not compile; names its path, never the pattern. */
export class TemplatePatternError extends Error {
  override readonly name = 'TemplatePatternError';
  readonly path: string | null;

  constructor(path: string | null) {
    super(
      path === null
        ? 'a template pattern does not compile'
        : `the template pattern at ${path} does not compile`,
    );
    this.path = path;
  }
}

const compiled = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  if (!compiled.has(pattern)) {
    let re: RegExp | null;
    try {
      re = new RegExp(pattern, 'iu');
    } catch {
      re = null;
    }
    compiled.set(pattern, re);
  }
  return compiled.get(pattern) ?? null;
}

/** True when `pattern`, case-insensitive, matches `text`; throws TemplatePatternError when it does not compile. */
export function patternMatches(pattern: string, text: string, path: string | null = null): boolean {
  const re = compile(pattern);
  if (re === null) {
    throw new TemplatePatternError(path);
  }
  return re.test(text);
}

/** The paths of every pattern of the template that does not compile, in file order. */
export function templatePatternErrors(template: StateTemplate): readonly string[] {
  const bad: string[] = [];
  const entryPattern = (path: string, pattern: string | null | undefined) => {
    if (pattern !== null && pattern !== undefined && compile(pattern) === null) {
      bad.push(`${path}.applies_to.name_pattern`);
    }
  };
  template.government_types.forEach((type, i) => {
    type.offices.forEach((entry, j) => {
      entryPattern(
        `government_types.${String(i)}.offices.${String(j)}`,
        entry.applies_to?.name_pattern,
      );
    });
  });
  template.special_districts.forEach((block, i) => {
    block.classifier.name_patterns.forEach((pattern, j) => {
      if (compile(pattern) === null) {
        bad.push(`special_districts.${String(i)}.classifier.name_patterns.${String(j)}`);
      }
    });
    block.offices.forEach((entry, j) => {
      entryPattern(
        `special_districts.${String(i)}.offices.${String(j)}`,
        entry.applies_to?.name_pattern,
      );
    });
  });
  template.statewide.forEach((entry, i) => {
    entryPattern(`statewide.${String(i)}`, entry.applies_to?.name_pattern);
  });
  template.party_committee.offices.forEach((entry, j) => {
    entryPattern(`party_committee.offices.${String(j)}`, entry.applies_to?.name_pattern);
  });
  return bad;
}

/**
 * A county, city, township or school district matches the first government type of its kind whose
 * `unit_type_codes` (null: any) and `school_levels` (null: any) hold the unit's; a special district
 * matches the first block whose function names hold the unit's and, when it has name patterns, one
 * of them matches the unit's name. Throws TemplatePatternError for a pattern that does not compile.
 */
export function matchUnit(unit: ExpandUnit, template: StateTemplate): UnitMatch {
  if (unit.kind === 'special_district') {
    const index = template.special_districts.findIndex((block, i) => {
      if (
        unit.functionName === null ||
        !block.classifier.function_names.includes(unit.functionName)
      ) {
        return false;
      }
      const patterns = block.classifier.name_patterns;
      return (
        patterns.length === 0 ||
        patterns.some((pattern, j) =>
          patternMatches(
            pattern,
            unit.name,
            `special_districts.${String(i)}.classifier.name_patterns.${String(j)}`,
          ),
        )
      );
    });
    return index === -1 ? { kind: 'none' } : { kind: 'special_district', index };
  }
  const index = template.government_types.findIndex(
    (type) =>
      type.kind === unit.kind &&
      (type.unit_type_codes === null ||
        (unit.unitTypeCode !== null && type.unit_type_codes.includes(unit.unitTypeCode))) &&
      (type.school_levels === null ||
        (unit.schoolLevel !== null && type.school_levels.includes(unit.schoolLevel))),
  );
  return index === -1 ? { kind: 'none' } : { kind: 'government_type', index };
}
