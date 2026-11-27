import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  OFFICE_HERO_FIXTURES,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { modelOf, t } from '../regions/testing/support.ts';
import { buildOfficeHeroModel, heroAltText } from './office-hero.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

describe('the office hero', () => {
  it('hero model and alt', () => {
    const model = buildOfficeHeroModel(
      RUN_AGAINST_FIXTURES.known,
      t,
      FIXTURE_CTX,
      NO_PHOTO_OPTIONS,
    );
    expect(model).toEqual(modelOf(RUN_AGAINST_FIXTURES.known).top);
    expect(model.sticker).toBeNull();
    expect(heroAltText(RUN_AGAINST_FIXTURES.known, t, FIXTURE_CTX)).toBe(
      'County Treasurer, Fixture Wren County, ZZ. Held by Carol Wynn since 2019.',
    );
    // With no holder the hero says the title alone.
    expect(heroAltText(RUN_AGAINST_FIXTURES.allUnknown, t, FIXTURE_CTX)).toBe(
      'County Treasurer, Fixture Wren County, ZZ.',
    );
    expect(heroAltText(OFFICE_HERO_FIXTURES.growsWithHolder, t, FIXTURE_CTX)).toBe(
      'Fixture Public Utility District Commissioner, Fixture Alder Public Utility District, ZZ. ' +
        'Held by Dana Okafor since 2021.',
    );
  });
});
