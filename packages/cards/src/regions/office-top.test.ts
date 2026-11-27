import { beforeAll, describe, expect, it } from 'vitest';
import { G, Image, Rect } from '@citizenrun/cards/primitives';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  OFFICE_HERO_FIXTURES,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { PHOTO_BOX, round1 } from '../canvas.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { buildOfficeHeroModel } from '../model/office-hero.ts';
import { officeHeroHeight } from '../templates/office-hero.tsx';
import { layoutBigNumber } from './big-number.tsx';
import { layoutOfficeTop, OfficeTopRegion } from './office-top.tsx';
import { COLORS, MEDIUM, modelOf, REGULAR, t } from './testing/support.ts';
import { draw, lineWith, linesOf } from './testing/tree.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const known = modelOf(RUN_AGAINST_FIXTURES.known);
const knownCapTop = layoutBigNumber(known.big).capTop;

describe('the office top', () => {
  it('the known top', () => {
    expect(round1(knownCapTop)).toBe(667.7);
    const layout = layoutOfficeTop(known.top, knownCapTop);
    expect(layout.title).toEqual({
      size: 92,
      lines: ['County', 'Treasurer'],
      baselines: [215.3, 311.3],
      cut: false,
    });
    expect(layout.place).toEqual({ lines: ['Fixture Wren County, ZZ'], baselines: [377.3] });
    expect(layout.election).toEqual({ text: 'Election Apr 6, 2027', baseline: 427.3 });
    expect(layout.holder).toEqual({
      line1: { text: 'Carol Wynn', baseline: 516 },
      line2: { text: 'holder since 2019', baseline: 564 },
    });
    expect(layout.art).toEqual({ id: 'county-treasurer', x: 630, y: 66, size: 540 });
    expect(layout.photo).toBeNull();
    expect(layout.bottom).toBe(564);

    const drawn = draw(OfficeTopRegion({ model: known.top, capTop: knownCapTop, colors: COLORS }));
    // The art is first, so the text column is drawn over nothing.
    expect(drawn[0]?.type).toBe(G);
    expect(drawn[0]?.props.transform).toBe('translate(630 66) scale(5.625)');
    expect(linesOf(drawn).map((line) => line.text)).toEqual([
      'PROPERTY TAXES',
      'County',
      'Treasurer',
      'Fixture Wren County, ZZ',
      'Election Apr 6, 2027',
      'Carol Wynn',
      'holder since 2019',
    ]);
    expect(lineWith(drawn, 'County').props).toEqual({
      x: 66,
      y: 215.3,
      ...MEDIUM,
      fontSize: 92,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'Treasurer').props).toMatchObject({ x: 66, y: 311.3, fontSize: 92 });
    expect(lineWith(drawn, 'Fixture Wren County, ZZ').props).toEqual({
      x: 66,
      y: 377.3,
      ...MEDIUM,
      fontSize: 42,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'Election Apr 6, 2027').props).toEqual({
      x: 66,
      y: 427.3,
      ...REGULAR,
      fontSize: 42,
      fill: 'c-text-secondary',
    });
    expect(lineWith(drawn, 'Carol Wynn').props).toEqual({
      x: 66,
      y: 516,
      ...MEDIUM,
      fontSize: 44,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'holder since 2019').props).toEqual({
      x: 66,
      y: 564,
      ...REGULAR,
      fontSize: 40,
      fill: 'c-text-secondary',
    });
  });

  it('the holder gives way', () => {
    // Line 2 at 564 needs 40 units over the number: it is left off, line 1 stays.
    const tight = layoutOfficeTop(known.top, 590);
    expect(tight.holder).toEqual({ line1: { text: 'Carol Wynn', baseline: 516 }, line2: null });
    expect(tight.bottom).toBe(516);

    const tighter = layoutOfficeTop(known.top, 540);
    expect(tighter.holder).toEqual({ line1: null, line2: null });
    expect(tighter.bottom).toBe(427.3);

    const drawn = draw(OfficeTopRegion({ model: known.top, capTop: 540, colors: COLORS }));
    expect(linesOf(drawn).map((line) => line.text)).not.toContain('Carol Wynn');
  });

  it('four lines drop the holder', () => {
    const model = modelOf(RUN_AGAINST_FIXTURES.longTitle);
    expect(model.top.holder).not.toBeNull();
    const layout = layoutOfficeTop(model.top, layoutBigNumber(model.big).capTop);
    expect(layout.title.size).toBe(64);
    expect(layout.title.lines).toHaveLength(4);
    expect(layout.title.lines.at(-1)?.endsWith('…')).toBe(true);
    expect(layout.title.cut).toBe(true);
    expect(layout.holder).toEqual({ line1: null, line2: null });
    // With nothing below to give way to, four lines still drop it.
    expect(layoutOfficeTop(model.top, Infinity).holder).toEqual({ line1: null, line2: null });
  });

  it('the hero grows', () => {
    const heroOf = (name: keyof typeof OFFICE_HERO_FIXTURES): number =>
      officeHeroHeight(
        buildOfficeHeroModel(OFFICE_HERO_FIXTURES[name], t, FIXTURE_CTX, NO_PHOTO_OPTIONS),
      );
    expect(heroOf('twoLineTitle')).toBe(640);
    expect(heroOf('growsWithHolder')).toBe(706);
  });

  it('a place that folds to nothing leaves no line', () => {
    const layout = layoutOfficeTop({ ...known.top, place: '' }, Infinity);
    expect(layout.place).toEqual({ lines: [], baselines: [] });
    expect(layout.election.baseline).toBe(377.3);
  });

  it('a photo replaces the art', () => {
    const model = { ...known.top, photoHref: 'https://media.example/p.jpg' };
    const layout = layoutOfficeTop(model, knownCapTop);
    expect(layout.art).toBeNull();
    expect(layout.photo?.box).toEqual(PHOTO_BOX);

    const drawn = draw(OfficeTopRegion({ model, capTop: knownCapTop, colors: COLORS }));
    expect(drawn.filter((node) => node.type === G && node.props.transform !== undefined)).toEqual(
      // The one group left is the issue icon of the kicker.
      drawn.filter((node) => String(node.props.transform).startsWith('translate(75 75)')),
    );
    expect(drawn[0]?.type).toBe(Image);
    expect(drawn[0]?.props).toEqual({
      ...PHOTO_BOX,
      href: 'https://media.example/p.jpg',
      preserveAspectRatio: 'xMidYMid slice',
    });
    expect(drawn[1]?.type).toBe(Rect);
    expect(drawn[1]?.props).toEqual({
      x: 615.5,
      y: 87.5,
      width: 397,
      height: 497,
      fill: 'none',
      stroke: 'c-rule-soft',
      strokeWidth: 3,
    });
  });
});
