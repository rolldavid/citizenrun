import { beforeAll, describe, expect, it } from 'vitest';
import { Rect, Svg } from '@citizenrun/cards/primitives';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  OFFICE_HERO_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { buildOfficeHeroModel } from '../model/office-hero.ts';
import type { OfficeTopModel } from '../model/region-models.ts';
import { BOLD, COLORS, t } from '../regions/testing/support.ts';
import { draw, linesOf } from '../regions/testing/tree.ts';
import { OfficeHeroCanvas, officeHeroHeight } from './office-hero.tsx';

beforeAll(() => {
  setStrictGlyphs(true);
});

function heroModel(name: keyof typeof OFFICE_HERO_FIXTURES): OfficeTopModel {
  return buildOfficeHeroModel(OFFICE_HERO_FIXTURES[name], t, FIXTURE_CTX, NO_PHOTO_OPTIONS);
}

describe('OfficeHeroCanvas', () => {
  it('the hero frame', () => {
    const model = heroModel('growsWithHolder');
    expect(officeHeroHeight(model)).toBe(706);
    const [root] = draw(<OfficeHeroCanvas model={model} colors={COLORS} width={540} />);
    expect(root?.type).toBe(Svg);
    expect(root?.props).toEqual({
      width: 540,
      height: 353,
      viewBox: '0 0 1080 706',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
    expect(root?.children[0]?.type).toBe(Rect);
    expect(root?.children[0]?.props).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 706,
      fill: 'c-surface',
    });
    // The whole holder block, since nothing below makes it give way; and no number.
    const lines = linesOf(root === undefined ? [] : [root]);
    expect(lines.map((line) => line.text)).toEqual([
      'PROPERTY TAXES',
      'Fixture Public',
      'Utility District',
      'Commissioner',
      'Fixture Alder Public Utility',
      'District, ZZ',
      'Election Apr 6, 2027',
      'Dana Okafor',
      'holder since 2021',
    ]);
    expect(lines.filter((line) => line.props.fontWeight === BOLD.fontWeight)).toEqual([]);
  });

  it('is its least height when the text column is short', () => {
    const [root] = draw(
      <OfficeHeroCanvas model={heroModel('twoLineTitle')} colors={COLORS} width={1080} />,
    );
    expect(root?.props).toMatchObject({ width: 1080, height: 640, viewBox: '0 0 1080 640' });
  });
});
