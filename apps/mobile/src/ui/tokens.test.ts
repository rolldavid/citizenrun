import { motion, typeRoles } from '@citizenrun/shared';
import { TOKENS_REFERENCE } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';

import {
  breakpoints,
  color,
  colorAliases,
  fixed,
  gutter,
  issue,
  ISSUE_IDS,
  MAP_NEUTRAL_STOPS,
  MAP_RAMP_STOPS,
  mapRamp,
  opacity,
  radius,
  rule,
  size,
  space,
} from './tokens';
import type { ThemeName } from './tokens';

const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** Reads a key of a token table by a name taken from the reference. */
function valueOf(table: object, key: string): unknown {
  return Object.hasOwn(table, key) ? (table as Record<string, unknown>)[key] : undefined;
}

/**
 * Names the reference holds and the app's token tables do not (D-818), with the value each must have:
 * the two canvas strokes of the cards package, and four spacings components build from the space steps.
 */
const REFERENCE_ONLY = {
  'rule.canvasMain': 4,
  'rule.canvasDivider': 3,
  'space.sectionGap': space.x6,
  'space.dialogPadding': space.x6,
  'space.tagPadding': [space.x1, space.x2],
  'space.issueGridGap': [space.x2, space.x1],
} as const;

/** The reference `space` keys compared by "space steps are the grid". */
const SPACE_COMPARED = ['step', 'gutter', 'gutterNarrow', 'narrowBelow', 'columnGap'];

/** The reference arrays of sizes, as the named sizes they stand for. */
const SIZE_ARRAYS: Readonly<Record<string, readonly number[]>> = {
  avatar: [size.avatar.sm, size.avatar.lg, size.avatar.xl],
  officeTile: [size.officeTile.sm, size.officeTile.md, size.officeTile.lg],
  pin: [size.pin.large, size.pin.medium, size.pin.small],
};

/** The reference `size` keys compared by "sizes equal the reference". */
function sizeKeysCompared(): string[] {
  return Object.keys(TOKENS_REFERENCE.size).filter((key) => valueOf(size, key) !== undefined);
}

function faceFor(family: string, weight: number): string {
  if (family === 'mono') return 'mono';
  if (weight === 400) return 'regular';
  if (weight === 500) return 'medium';
  if (weight === 700) return 'bold';
  throw new Error(`no face for ${family} ${String(weight)}`);
}

describe('design tokens equal the reference', () => {
  it('colors equal the reference', () => {
    for (const theme of THEMES) {
      const reference: Readonly<Record<string, string>> = TOKENS_REFERENCE.themes[theme];
      expect(Object.keys(reference)).toHaveLength(58);
      expect(Object.keys(color[theme]).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, value] of Object.entries(reference)) {
        expect(valueOf(color[theme], key), `${theme}.${key}`).toBe(value);
      }
    }
  });

  it('aliases resolve to their targets', () => {
    expect(colorAliases).toEqual(TOKENS_REFERENCE.aliases);
    for (const theme of THEMES) {
      for (const [alias, target] of Object.entries(colorAliases)) {
        expect(valueOf(color[theme], alias), `${theme}.${alias}`).toBe(
          valueOf(color[theme], target),
        );
      }
    }
  });

  it('opacity and radius equal the reference', () => {
    expect(opacity).toEqual(TOKENS_REFERENCE.opacity);
    expect(radius).toEqual(TOKENS_REFERENCE.radius);
  });

  it('rule equals the reference', () => {
    const compared = Object.entries(TOKENS_REFERENCE.rule).filter(
      ([key]) => valueOf(rule, key) !== undefined,
    );
    expect(compared.length).toBeGreaterThan(0);
    for (const [key, value] of compared) {
      expect(valueOf(rule, key), `rule.${key}`).toBe(value);
    }
  });

  it('every reference name is mapped', () => {
    const mapped = new Set<string>([
      ...Object.keys(TOKENS_REFERENCE.rule)
        .filter((key) => valueOf(rule, key) !== undefined)
        .map((key) => `rule.${key}`),
      ...SPACE_COMPARED.map((key) => `space.${key}`),
      ...sizeKeysCompared().map((key) => `size.${key}`),
      ...Object.keys(REFERENCE_ONLY),
    ]);
    const referenceNames = [
      ...Object.keys(TOKENS_REFERENCE.rule).map((key) => `rule.${key}`),
      ...Object.keys(TOKENS_REFERENCE.space).map((key) => `space.${key}`),
      ...Object.keys(TOKENS_REFERENCE.size).map((key) => `size.${key}`),
    ];
    expect(referenceNames.filter((name) => !mapped.has(name))).toEqual([]);
    // A name in the table is one the app does not define, so it is never compared twice.
    expect(valueOf(rule, 'canvasMain')).toBeUndefined();
    expect(valueOf(rule, 'canvasDivider')).toBeUndefined();

    expect(TOKENS_REFERENCE.rule.canvasMain).toBe(REFERENCE_ONLY['rule.canvasMain']);
    expect(TOKENS_REFERENCE.rule.canvasDivider).toBe(REFERENCE_ONLY['rule.canvasDivider']);
    expect(REFERENCE_ONLY['rule.canvasMain']).toBe(4);
    expect(REFERENCE_ONLY['rule.canvasDivider']).toBe(3);
    expect(TOKENS_REFERENCE.space.sectionGap).toBe(space.x6);
    expect(TOKENS_REFERENCE.space.dialogPadding).toBe(space.x6);
    expect(TOKENS_REFERENCE.space.tagPadding).toEqual([space.x1, space.x2]);
    expect(TOKENS_REFERENCE.space.issueGridGap).toEqual([space.x2, space.x1]);
  });

  it('space steps are the grid', () => {
    const steps = [
      space.pip,
      space.x1,
      space.x2,
      space.x3,
      space.x4,
      space.x6,
      space.x8,
      space.x12,
    ];
    expect(steps).toEqual([2, 4, 8, 12, 16, 24, 32, 48]);
    expect(steps).toEqual(TOKENS_REFERENCE.space.step);
    expect(gutter.regular).toBe(TOKENS_REFERENCE.space.gutter);
    expect(gutter.narrow).toBe(TOKENS_REFERENCE.space.gutterNarrow);
    expect(gutter.narrowBelow).toBe(TOKENS_REFERENCE.space.narrowBelow);
    expect(size.columnGap).toBe(TOKENS_REFERENCE.space.columnGap);
  });

  it('sizes equal the reference', () => {
    const compared = sizeKeysCompared();
    expect(compared).toEqual(Object.keys(TOKENS_REFERENCE.size));
    for (const key of compared) {
      const reference = valueOf(TOKENS_REFERENCE.size, key);
      const named = SIZE_ARRAYS[key];
      if (named !== undefined) {
        expect(named, `size.${key}`).toEqual(reference);
      } else {
        expect(valueOf(size, key), `size.${key}`).toEqual(reference);
      }
    }
  });

  it('touch targets', () => {
    expect(size.target).toBe(44);
  });

  it('breakpoints', () => {
    expect(breakpoints).toEqual({ medium: 600, expanded: 1024 });
    expect(breakpoints).toEqual(TOKENS_REFERENCE.breakpoints);
    expect(size.contentMax).toBe(1280);
  });

  it('issue colors equal the reference', () => {
    expect(TOKENS_REFERENCE.issues).toHaveLength(19);
    expect([...ISSUE_IDS].sort()).toEqual(TOKENS_REFERENCE.issues.map(({ id }) => id).sort());
    for (const reference of TOKENS_REFERENCE.issues) {
      const token = valueOf(issue, reference.id);
      expect(token, reference.id).toEqual({
        light: reference.light,
        dark: reference.dark,
        on: reference.on,
        pigment: reference.pigment,
        tone: reference.tone,
      });
    }
  });

  it('map ramps equal the reference', () => {
    for (const reference of TOKENS_REFERENCE.issues) {
      const ramp = valueOf(mapRamp, reference.id);
      expect(ramp, reference.id).toEqual({ light: reference.rampLight, dark: reference.rampDark });
    }
    expect(mapRamp.neutral).toEqual(TOKENS_REFERENCE.neutralRamp);
    expect(MAP_RAMP_STOPS).toEqual(TOKENS_REFERENCE.mapRampStops);
    expect(MAP_NEUTRAL_STOPS).toEqual(TOKENS_REFERENCE.mapNeutralStops);
  });

  it('motion equals the reference', () => {
    const reference = TOKENS_REFERENCE.motion;
    expect(motion.spring).toEqual(reference.springs);
    expect(motion.easeOut).toEqual(reference.easeOut);
    expect(motion.scale).toEqual(reference.scale);
    expect(motion.rotate).toEqual(reference.rotate);
    expect(motion.distance).toEqual(reference.distance);
    for (const [key, value] of Object.entries(reference.duration)) {
      expect(valueOf(motion.duration, key), `duration.${key}`).toBe(value);
    }
  });

  it('type roles equal the reference', () => {
    const roles = Object.entries(TOKENS_REFERENCE.type.roles);
    expect(roles.length).toBeGreaterThan(0);
    for (const [role, spec] of roles) {
      const [fontSize, lineHeight, weight, tracking, letterCase, family, capped] = spec as [
        number,
        number,
        number,
        number,
        string,
        string,
        boolean,
      ];
      expect(valueOf(typeRoles, role), role).toEqual({
        face: faceFor(family, weight),
        size: fontSize,
        lineHeight,
        tracking,
        uppercase: letterCase === 'capitals',
        capped,
      });
    }
  });

  it('the notification tint equals the reference', () => {
    expect(fixed.notificationTint).toBe(TOKENS_REFERENCE.notificationTint);
  });
});
