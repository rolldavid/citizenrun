import { beforeAll, describe, expect, it } from 'vitest';
import { RUN_AGAINST_FIXTURES } from '../__fixtures__/office.fixtures.ts';
import { round1 } from '../canvas.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { BigNumberRegion, layoutBigNumber } from './big-number.tsx';
import { BOLD, COLORS, MEDIUM, modelOf } from './testing/support.ts';
import { draw, lineWith, linesOf } from './testing/tree.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

describe('the big number', () => {
  it('fitted figure', () => {
    const known = modelOf(RUN_AGAINST_FIXTURES.known).big;
    const layout = layoutBigNumber(known);
    expect(layout.figure?.size).toBe(237);
    // The figure moves left by its bearing, so its edge meets the margin.
    expect(layout.figure?.x).toBeCloseTo(66 - 4.74, 6);
    expect(layout.prefix).toBe(0);
    expect(round1(layout.capTop)).toBe(667.7);

    const drawn = draw(BigNumberRegion({ model: known, colors: COLORS, ground: 'paper' }));
    expect(linesOf(drawn).map((line) => line.text)).toEqual([
      '$52,900',
      'a year · about 20 hours a week',
    ]);
    expect(lineWith(drawn, '$52,900').props).toEqual({
      x: 61.3,
      y: 836,
      ...BOLD,
      fontSize: 237,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'a year · about 20 hours a week').props).toEqual({
      x: 66,
      y: 916,
      ...MEDIUM,
      fontSize: 44,
      fill: 'c-text',
    });
  });

  it('the estimate word leads the figure', () => {
    const low = modelOf(RUN_AGAINST_FIXTURES.lowConfidence).big;
    const layout = layoutBigNumber(low);
    expect(round1(layout.prefix)).toBe(206.5);
    expect(layout.figure?.size).toBe(185);
    expect(round1(layout.capTop)).toBe(704.7);

    const drawn = draw(BigNumberRegion({ model: low, colors: COLORS, ground: 'paper' }));
    expect(linesOf(drawn).map((line) => line.text)).toEqual([
      'about',
      '$52,900',
      'a year · about 20 hours a week',
    ]);
    expect(lineWith(drawn, 'about').props).toEqual({
      x: 66,
      y: 836,
      ...MEDIUM,
      fontSize: 72,
      fill: 'c-text',
    });
    expect(lineWith(drawn, '$52,900').props).toMatchObject({ x: 272.5, y: 836, fontSize: 185 });
  });

  it('the unknown phrase is never heavy', () => {
    const unknown = modelOf(RUN_AGAINST_FIXTURES.allUnknown).big;
    const layout = layoutBigNumber(unknown);
    expect(layout.figure).toBeNull();
    expect(layout.phrase?.size).toBe(112);
    expect(round1(layout.capTop)).toBe(756.5);

    const drawn = draw(BigNumberRegion({ model: unknown, colors: COLORS, ground: 'paper' }));
    expect(linesOf(drawn).filter((line) => line.props.fontWeight === BOLD.fontWeight)).toEqual([]);
    expect(lineWith(drawn, 'not known yet').props).toEqual({
      x: 66,
      y: 836,
      ...MEDIUM,
      fontSize: 112,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'pay').props).toMatchObject({ x: 66, y: 916, fontSize: 44 });
  });

  it('takes the poster ink on a poster', () => {
    const known = modelOf(RUN_AGAINST_FIXTURES.known).big;
    const drawn = draw(BigNumberRegion({ model: known, colors: COLORS, ground: 'poster' }));
    expect(linesOf(drawn).map((line) => line.props.fill)).toEqual([
      'c-poster-text',
      'c-poster-text',
    ]);
  });
});
