import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { G, Svg, svgRootProps } from '@citizenrun/cards/primitives';
import { OFFICE_ART, OFFICE_ART_IDS, OFFICE_ART_META, PIN_GLYPHS } from '../generated/index.ts';
import { OFFICE_TYPE_ILLUSTRATION } from '../generated/office-type-illustrations.ts';
import { hasOfficeType, illustrationFor, OfficeArt, OfficeArtSvg } from './office-art.tsx';

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

const ROLES = { ink: 'I', paper: 'P', tone: 'T', spot: 'S', neutral: 'N' };
const FOUR_ROLES = { ink: 'I', paper: 'P', tone: 'T', spot: 'S' };

/** The six drawings of the set that are drawn, with their crop line and the size of their spot. */
const DRAWN = {
  'county-treasurer': { crop: 80, spot: [8, 24], placeholderOf: null },
  'school-board': { crop: 84, spot: [12, 6], placeholderOf: null },
  'water-district-board': { crop: 80, spot: [10, 10], placeholderOf: null },
  'city-council': { crop: 73.5, spot: [14, 16], placeholderOf: null },
  sheriff: { crop: 84, spot: [16, 7], placeholderOf: null },
  'utility-commission': { crop: 84, spot: [10, 12], placeholderOf: null },
} as const;

function onlyChild(element: Node): Node {
  const children = Children.toArray(element.props.children).filter((child): child is Node =>
    isValidElement(child),
  );
  expect(children).toHaveLength(1);
  const [child] = children;
  if (child === undefined) {
    throw new Error('the element has no child');
  }
  return child;
}

describe('illustrationFor', () => {
  it('maps the shared drawings', () => {
    expect(illustrationFor('us-senate')).toBe('congress');
    expect(illustrationFor('us-house')).toBe('congress');
    expect(illustrationFor('state-senate')).toBe('legislature');
    expect(illustrationFor('state-house')).toBe('legislature');
    expect(illustrationFor('party-precinct-committee')).toBe('party-committee');
    expect(illustrationFor('party-committee')).toBe('party-committee');
    expect(illustrationFor('county-treasurer')).toBe('county-treasurer');
  });

  it('falls back to the city council for an unknown type', () => {
    expect(illustrationFor('not-a-type')).toBe('city-council');
    expect(illustrationFor('constructor')).toBe('city-council');
    expect(hasOfficeType('not-a-type')).toBe(false);
    expect(hasOfficeType('constructor')).toBe(false);
    expect(hasOfficeType('county-treasurer')).toBe(true);
  });

  it('the table has 42 types and 39 drawings', () => {
    expect(Object.keys(OFFICE_TYPE_ILLUSTRATION)).toHaveLength(42);
    expect(new Set(Object.values(OFFICE_TYPE_ILLUSTRATION)).size).toBe(39);
    expect(Object.values(OFFICE_TYPE_ILLUSTRATION)).toContain('city-council');
  });
});

describe('OfficeArtSvg', () => {
  it('OfficeArtSvg draws the 96 grid at the given size', () => {
    const art: Node = OfficeArtSvg({ id: 'county-treasurer', size: 96, roles: ROLES });
    expect(art.type).toBe(Svg);
    expect(art.props).toMatchObject({
      width: 96,
      height: 96,
      viewBox: '0 0 96 96',
      ...svgRootProps(),
    });
    const child = onlyChild(art);
    expect(child.type).toBe(OFFICE_ART['county-treasurer']);
    expect(child.props).toEqual(FOUR_ROLES);
  });

  it('an unknown id draws the city council', () => {
    for (const id of ['no-such-drawing', 'constructor', '']) {
      const child = onlyChild(OfficeArtSvg({ id, size: 96, roles: ROLES }));
      expect(child.type, id).toBe(OFFICE_ART['city-council']);
      // The fallback is the drawn city council, so it keeps the tone it is given.
      expect(child.props, id).toEqual(FOUR_ROLES);
    }
    const placed = onlyChild(
      OfficeArt({ id: 'no-such-drawing', x: 0, y: 0, size: 96, roles: ROLES }),
    );
    expect(placed.type).toBe(OFFICE_ART['city-council']);
  });
});

describe('OfficeArt', () => {
  it('OfficeArt places and scales', () => {
    const art: Node = OfficeArt({ id: 'county-treasurer', x: 630, y: 66, size: 540, roles: ROLES });
    expect(art.type).toBe(G);
    expect(art.props.transform).toBe('translate(630 66) scale(5.625)');
    const child = onlyChild(art);
    expect(child.type).toBe(OFFICE_ART['county-treasurer']);
    expect(child.props).toEqual(FOUR_ROLES);
  });

  it('writes the place to one decimal and the scale to three', () => {
    const art: Node = OfficeArt({ id: 'sheriff', x: 10.26, y: 0.04, size: 100, roles: ROLES });
    expect(art.props.transform).toBe('translate(10.3 0) scale(1.042)');
  });

  it('a placeholder draws the neutral tone', () => {
    for (const draw of [
      (id: string): Node => OfficeArtSvg({ id, size: 96, roles: ROLES }),
      (id: string): Node => OfficeArt({ id, x: 0, y: 0, size: 96, roles: ROLES }),
    ]) {
      const placeholder = onlyChild(draw('state-treasurer'));
      expect(placeholder.type).toBe(OFFICE_ART['state-treasurer']);
      expect(placeholder.props).toEqual({ ...FOUR_ROLES, tone: ROLES.neutral });
      expect(onlyChild(draw('county-treasurer')).props.tone).toBe(ROLES.tone);
    }
    // Every id of the set follows its own source: neutral exactly when it is a copy.
    for (const id of OFFICE_ART_IDS) {
      const { tone } = onlyChild(OfficeArtSvg({ id, size: 96, roles: ROLES })).props;
      expect(tone, id).toBe(OFFICE_ART_META[id].placeholderOf === null ? 'T' : 'N');
    }
  });
});

describe('the office art set', () => {
  it('every id has a drawing and a glyph', () => {
    expect(OFFICE_ART_IDS).toHaveLength(39);
    expect(Object.keys(OFFICE_ART)).toEqual([...OFFICE_ART_IDS]);
    expect(Object.keys(PIN_GLYPHS)).toEqual([...OFFICE_ART_IDS]);
    expect(Object.keys(OFFICE_ART_META)).toEqual([...OFFICE_ART_IDS]);
    for (const id of OFFICE_ART_IDS) {
      expect(typeof OFFICE_ART[id], id).toBe('function');
      expect(typeof PIN_GLYPHS[id], id).toBe('function');
      expect(OFFICE_ART_META[id].crop, id).toBeGreaterThanOrEqual(72);
      expect(OFFICE_ART_META[id].crop, id).toBeLessThanOrEqual(88);
    }
  });

  it('the meta of the six', () => {
    const drawn = OFFICE_ART_IDS.filter((id) => OFFICE_ART_META[id].placeholderOf === null);
    expect([...drawn].sort()).toEqual(Object.keys(DRAWN).sort());
    for (const [id, meta] of Object.entries(DRAWN)) {
      expect(OFFICE_ART_META[id as keyof typeof DRAWN], id).toEqual(meta);
    }
    expect(OFFICE_ART_META['city-council'].crop).toBe(73.5);
    // A placeholder carries its relative's crop line and spot, and its relative is one of the six.
    for (const id of OFFICE_ART_IDS) {
      const { placeholderOf, crop, spot } = OFFICE_ART_META[id];
      if (placeholderOf !== null) {
        expect(Object.keys(DRAWN), id).toContain(placeholderOf);
        expect({ crop, spot }, id).toEqual({
          crop: OFFICE_ART_META[placeholderOf].crop,
          spot: OFFICE_ART_META[placeholderOf].spot,
        });
      }
    }
    // The patrol car stands in for nothing.
    const relatives = OFFICE_ART_IDS.map((id): string | null => OFFICE_ART_META[id].placeholderOf);
    expect(relatives).not.toContain('sheriff');
    expect(relatives.filter((relative) => relative !== null)).toHaveLength(33);
  });
});
