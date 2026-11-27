import { BRAND, createI18n, formatDate } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { CANVAS } from '../canvas.ts';
import type { CanvasColors, CardTheme } from '../colors.ts';
import type { CanvasPage } from '../feed.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import type { BigNumberModel, FactModel } from '../model/region-models.ts';
import { altText, altTextSentences, buildRunAgainstModel } from '../model/run-against.ts';
import type { RunAgainstData, RunAgainstModel } from '../model/run-against.ts';
import { runAgainstFitProblems } from '../regions/fit.ts';
import { CardCanvas } from '../templates/card-canvas.tsx';
import { CARD_COLORS, cardT, expectAltGolden, expectCardGolden } from './testing/golden.ts';

// TEST-card-render and CARD-tests for the run-against canvas (D-277).

type FixtureName = keyof typeof RUN_AGAINST_FIXTURES;
type Field = 'pay' | 'votes' | 'days';

const FIXTURE_NAMES = Object.keys(RUN_AGAINST_FIXTURES) as FixtureName[];
const THEMES: readonly CardTheme[] = ['light', 'dark'];
const SIZE = { width: 540, height: 675 };
/** From this many days the date line under the count carries the year. */
const YEAR_FROM_DAYS = 330;

let tEn: TFunction;
let tPseudo: TFunction;

beforeAll(async () => {
  setStrictGlyphs(true);
  tEn = await cardT('en');
  tPseudo = await cardT('pseudo');
});

const ctx = FIXTURE_CTX;

function modelOf(data: RunAgainstData): RunAgainstModel {
  return buildRunAgainstModel(data, tEn, ctx, NO_PHOTO_OPTIONS);
}

function renderOf(data: RunAgainstData): (colors: CanvasColors) => ReactElement {
  const page: CanvasPage = {
    key: data.office.id,
    officeId: data.office.id,
    template: 'run_against',
    model: modelOf(data),
    alt: altText(data, tEn, ctx),
  };
  return function render(colors) {
    return <CardCanvas page={page} colors={colors} width={SIZE.width} />;
  };
}

function markupOf(data: RunAgainstData, theme: CardTheme): string {
  return renderToStaticMarkup(renderOf(data)(CARD_COLORS[theme]));
}

const TEXT_ELEMENT = /<text\b([^>]*)>([^<]*)<\/text>/g;

/** Each `<text>` element of the markup: its attributes as written and its decoded content. */
function textsOf(markup: string): { attributes: string; content: string }[] {
  return [...markup.matchAll(TEXT_ELEMENT)].map((match) => ({
    attributes: match[1] ?? '',
    content: (match[2] ?? '')
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  }));
}

/** The Bold text elements that hold a digit: the numbers of a canvas. */
function boldNumbers(markup: string): string[] {
  return textsOf(markup)
    .filter((text) => text.attributes.includes('font-weight="700"') && /\d/.test(text.content))
    .map((text) => text.content);
}

/** The field a fact names by its label. */
function factField(fact: FactModel): Field {
  const byLabel: Readonly<Record<string, Field>> = {
    [tEn('cards:fact.pay')]: 'pay',
    [tEn('cards:fact.votesToWin')]: 'votes',
    [tEn('cards:fact.daysToFile_one')]: 'days',
    [tEn('cards:fact.daysToFile_other')]: 'days',
    [tEn('cards:fact.filing')]: 'days',
    [tEn('cards:fact.nextElection')]: 'days',
  };
  const field = byLabel[fact.label];
  if (field === undefined) {
    throw new Error(`the fact label "${fact.label}" names no field`);
  }
  return field;
}

/** The big-number captions of the catalog, each as a pattern that matches its interpolated text. */
function captionPatterns(): { key: string; pattern: RegExp }[] {
  const run = createI18n().getResourceBundle('en', 'cards') as { run: Record<string, string> };
  return Object.entries(run.run)
    .filter(([key]) => key.startsWith('caption'))
    .map(([key, value]) => {
      const parts = value.split(/\{\{[^}]*\}\}/);
      const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return { key, pattern: new RegExp(`^${escaped.join('.+')}$`) };
    });
}

/** The field the big number names: pay when it is the unknown form, else the field of its caption. */
function bigField(big: BigNumberModel): Field {
  if (big.kind === 'unknown') {
    return 'pay';
  }
  const match = captionPatterns().find(({ pattern }) => pattern.test(big.caption));
  if (match === undefined) {
    throw new Error(`the caption "${big.caption}" is no catalog caption`);
  }
  if (match.key === 'captionVotes') {
    return 'votes';
  }
  return match.key.startsWith('captionDays') ? 'days' : 'pay';
}

/** True when the label is one of the two forms of the days-to-file label. */
function isDaysToFile(label: string): boolean {
  return label === tEn('cards:fact.daysToFile_one') || label === tEn('cards:fact.daysToFile_other');
}

describe('OfficeCard renders to PNG', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} matches its golden files in both themes`, async () => {
      await expectCardGolden(`run-against.${name}`, renderOf(RUN_AGAINST_FIXTURES[name]), SIZE);
    });
  }
});

describe('card checks', () => {
  it('alt text is whole sentences', () => {
    for (const name of FIXTURE_NAMES) {
      const data = RUN_AGAINST_FIXTURES[name];
      const english = altText(data, tEn, ctx);
      const pseudo = altText(data, tPseudo, ctx);
      expectAltGolden(`run-against.${name}`, 'en', english);
      expectAltGolden(`run-against.${name}`, 'pseudo', pseudo);

      const sentences = altTextSentences(data, tEn, ctx);
      expect(sentences.length, name).toBeGreaterThan(0);
      for (const sentence of sentences) {
        expect(sentence.endsWith('.'), `${name}: ${sentence}`).toBe(true);
      }
      expect(english, name).toBe(sentences.join(' '));
      // The pseudo-locale wraps every catalog value, so with its marks removed it reads as English.
      expect(pseudo.startsWith('['), name).toBe(true);
      expect(pseudo.replace(/[[\]~]/g, ''), name).toBe(english);
    }
  });

  it('at most three numbers', () => {
    for (const name of FIXTURE_NAMES) {
      for (const theme of THEMES) {
        const markup = markupOf(RUN_AGAINST_FIXTURES[name], theme);
        expect(boldNumbers(markup).length, `${name} ${theme}`).toBeLessThanOrEqual(3);
        if (name === 'allUnknown') {
          // A canvas with no figure has no Bold at all.
          expect(markup, `${name} ${theme}`).not.toContain('font-weight="700"');
        }
      }
    }
    expect(boldNumbers(markupOf(RUN_AGAINST_FIXTURES.known, 'light'))).toEqual([
      '$52,900',
      '2,100',
      '12',
    ]);
  });

  it('unknown is said once', () => {
    for (const name of FIXTURE_NAMES) {
      const model = modelOf(RUN_AGAINST_FIXTURES[name]);
      const [first, second] = model.facts.map(factField);
      const big = bigField(model.big);
      expect(first, name).not.toBe(second);
      expect([first, second], name).not.toContain(big);
    }
    expect(bigField(modelOf(RUN_AGAINST_FIXTURES.allUnknown).big)).toBe('pay');
  });

  it('a day count has its date', () => {
    let counted = 0;
    for (const name of FIXTURE_NAMES) {
      const data = RUN_AGAINST_FIXTURES[name];
      const model = modelOf(data);
      const contents = textsOf(markupOf(data, 'light')).map((text) => text.content);
      const deadline = data.office.filingDeadline;
      for (const fact of model.facts) {
        if (fact.kind !== 'figure' || !isDaysToFile(fact.label)) {
          continue;
        }
        if (deadline === null) {
          throw new Error(`${name} counts days to a deadline it does not have`);
        }
        const days = Number(fact.value.replace(/\D/g, ''));
        const date = formatDate(
          deadline.date,
          'en',
          days >= YEAR_FROM_DAYS ? 'medium' : 'weekdayShort',
        );
        expect(fact.dateLine, name).not.toBeNull();
        expect(fact.dateLine ?? '', name).toContain(date);
        expect(contents, name).toContain(fact.dateLine);
        counted += 1;
      }
      if (model.big.kind === 'figure' && bigField(model.big) === 'days') {
        if (deadline === null) {
          throw new Error(`${name} counts days to a deadline it does not have`);
        }
        expect(model.big.caption, name).toContain(formatDate(deadline.date, 'en', 'weekdayShort'));
        counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(0);
  });

  it('no line leaves its slot', () => {
    for (const name of FIXTURE_NAMES) {
      expect(runAgainstFitProblems(modelOf(RUN_AGAINST_FIXTURES[name])), name).toEqual([]);
    }
  });

  it('the photo slot is off', () => {
    expect(CANVAS.photoSlotEnabled).toBe(false);
    for (const name of FIXTURE_NAMES) {
      const data = RUN_AGAINST_FIXTURES[name];
      expect(modelOf(data).top.photoHref, name).toBeNull();
      for (const theme of THEMES) {
        expect(markupOf(data, theme), `${name} ${theme}`).not.toContain('<image');
      }
    }
  });

  it('the name is never in capitals', () => {
    const product = BRAND.displayName.toLowerCase();
    for (const name of FIXTURE_NAMES) {
      for (const theme of THEMES) {
        const markup = markupOf(RUN_AGAINST_FIXTURES[name], theme);
        expect(markup.toLowerCase().includes(product), `${name} ${theme}`).toBe(false);
      }
    }
  });
});
