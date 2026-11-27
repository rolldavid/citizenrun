import type { TFunction } from '@citizenrun/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  OFFICE_HERO_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { CANVAS } from '../canvas.ts';
import type { CanvasColors, CardTheme } from '../colors.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { buildOfficeHeroModel, heroAltText } from '../model/office-hero.ts';
import type { OfficeTopModel } from '../model/region-models.ts';
import type { RunAgainstData } from '../model/run-against.ts';
import { officeTopFitProblems } from '../regions/fit.ts';
import { OfficeHeroCanvas, officeHeroHeight } from '../templates/office-hero.tsx';
import { CARD_COLORS, cardT, expectAltGolden, expectCardGolden } from './testing/golden.ts';

// TEST-card-render and CARD-tests for the office hero (CARD-office-hero).

type FixtureName = keyof typeof OFFICE_HERO_FIXTURES;

const FIXTURE_NAMES = Object.keys(OFFICE_HERO_FIXTURES) as FixtureName[];
const THEMES: readonly CardTheme[] = ['light', 'dark'];
const WIDTH = 540;
/** The hero's height in units on each fixture: its least height, and one grown by its text column. */
const HEIGHTS: Readonly<Record<FixtureName, number>> = { twoLineTitle: 640, growsWithHolder: 706 };

let tEn: TFunction;
let tPseudo: TFunction;

beforeAll(async () => {
  setStrictGlyphs(true);
  tEn = await cardT('en');
  tPseudo = await cardT('pseudo');
});

const ctx = FIXTURE_CTX;

function modelOf(data: RunAgainstData): OfficeTopModel {
  return buildOfficeHeroModel(data, tEn, ctx, NO_PHOTO_OPTIONS);
}

function renderOf(data: RunAgainstData): (colors: CanvasColors) => ReactElement {
  const model = modelOf(data);
  return function render(colors) {
    return <OfficeHeroCanvas model={model} colors={colors} width={WIDTH} />;
  };
}

describe('office hero', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} matches its golden files in both themes`, async () => {
      const data = OFFICE_HERO_FIXTURES[name];
      const h = officeHeroHeight(modelOf(data));
      expect(h).toBe(HEIGHTS[name]);
      await expectCardGolden(`office-hero.${name}`, renderOf(data), {
        width: WIDTH,
        height: Math.round((WIDTH * h) / CANVAS.width),
      });
    });
  }

  it('hero alt text', () => {
    for (const name of FIXTURE_NAMES) {
      const data = OFFICE_HERO_FIXTURES[name];
      const english = heroAltText(data, tEn, ctx);
      const pseudo = heroAltText(data, tPseudo, ctx);
      expectAltGolden(`office-hero.${name}`, 'en', english);
      expectAltGolden(`office-hero.${name}`, 'pseudo', pseudo);
      expect(pseudo.startsWith('['), name).toBe(true);
      expect(pseudo.replace(/[[\]~]/g, ''), name).toBe(english);
    }
  });

  it('no number on a hero', () => {
    for (const name of FIXTURE_NAMES) {
      for (const theme of THEMES) {
        const markup = renderToStaticMarkup(
          renderOf(OFFICE_HERO_FIXTURES[name])(CARD_COLORS[theme]),
        );
        expect(markup, `${name} ${theme}`).toContain('<text');
        expect(markup, `${name} ${theme}`).not.toMatch(/<text\b[^>]*font-weight="700"/);
      }
    }
  });

  it('no line leaves its slot', () => {
    for (const name of FIXTURE_NAMES) {
      expect(officeTopFitProblems(modelOf(OFFICE_HERO_FIXTURES[name])), name).toEqual([]);
    }
  });
});
