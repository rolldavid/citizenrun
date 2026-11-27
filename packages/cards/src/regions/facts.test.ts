import { beforeAll, describe, expect, it } from 'vitest';
import { Rect } from '@citizenrun/cards/primitives';
import { RUN_AGAINST_FIXTURES } from '../__fixtures__/office.fixtures.ts';
import { round1 } from '../canvas.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import type { FactModel } from '../model/region-models.ts';
import { FACT_COLUMNS, FactsRegion, layoutFact, layoutFacts } from './facts.tsx';
import {
  BOLD,
  COLORS,
  dataOf,
  deadlineOn,
  MEDIUM,
  modelOf,
  MONO,
  officeWith,
  REGULAR,
} from './testing/support.ts';
import { draw, lineWith, linesOf } from './testing/tree.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const known = modelOf(RUN_AGAINST_FIXTURES.known).facts;

describe('the facts', () => {
  it('steps and the flag', () => {
    const [votes, days] = layoutFacts(known);
    // "about 2,100" fits its column at the first step.
    expect(votes.figure).toMatchObject({ text: '2,100', size: 100, fits: true });
    expect(round1(votes.figure?.x ?? 0)).toBe(194.8);
    expect(days.figure).toMatchObject({ text: '12', size: 100, x: 576, about: null });

    const drawn = draw(FactsRegion({ facts: known, colors: COLORS, ground: 'paper' }));
    // The rule over both facts, then the divider between them.
    expect(drawn[0]?.type).toBe(Rect);
    expect(drawn[0]?.props).toEqual({ x: 66, y: 946, width: 948, height: 4, fill: 'c-text' });
    expect(drawn[1]?.props).toEqual({ x: 538.5, y: 946, width: 3, height: 236, fill: 'c-text' });
    expect(drawn.filter((node) => node.type === Rect)).toHaveLength(2);
    expect(linesOf(drawn).map((line) => line.text)).toEqual([
      'about',
      '2,100',
      'VOTES TO WIN',
      '12',
      'DAYS TO FILE',
      'closes Fri, Nov 27',
    ]);
    expect(lineWith(drawn, 'about').props).toEqual({
      x: 66,
      y: 1062,
      ...MEDIUM,
      fontSize: 44,
      fill: 'c-text',
    });
    expect(lineWith(drawn, '2,100').props).toEqual({
      x: 194.8,
      y: 1062,
      ...BOLD,
      fontSize: 100,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'VOTES TO WIN').props).toEqual({
      x: 66,
      y: 1122,
      ...MONO,
      fontSize: 40,
      fill: 'c-text',
    });
    expect(lineWith(drawn, 'closes Fri, Nov 27').props).toEqual({
      x: 576,
      y: 1172,
      ...REGULAR,
      fontSize: 42,
      fill: 'c-text',
    });
  });

  it('seven days or fewer put the label on the flag', () => {
    const facts = modelOf(dataOf(officeWith({ filingDeadline: deadlineOn('2026-11-20') }))).facts;
    expect(facts[1]).toMatchObject({ value: '5', flag: true });

    const drawn = draw(FactsRegion({ facts, colors: COLORS, ground: 'paper' }));
    const [, , flag] = drawn.filter((node) => node.type === Rect);
    const label = lineWith(drawn, 'DAYS TO FILE');
    const labelWidth = layoutFacts(facts)[1].label.width;
    expect(flag?.props).toEqual({
      x: 574,
      y: 1082,
      width: round1(labelWidth + 28),
      height: 52,
      fill: 'c-highlight',
      stroke: 'c-on-highlight',
      strokeWidth: 3,
    });
    expect(label.props).toMatchObject({ x: 588, y: 1122, fill: 'c-on-highlight' });
    // The block is drawn before the label that sits on it.
    expect(drawn.indexOf(flag ?? label)).toBeLessThan(drawn.indexOf(label));
    expect(lineWith(drawn, 'closes Fri, Nov 20').props).toMatchObject({
      ...REGULAR,
      fontSize: 42,
      fill: 'c-text',
    });
  });

  it('a figure steps down until it fits, and a phrase is never heavy', () => {
    const wide: FactModel = {
      kind: 'figure',
      value: '123,456',
      aboutWord: 'about',
      label: 'Votes to win',
      flag: false,
      dateLine: null,
    };
    const stepped = layoutFact(wide, FACT_COLUMNS[0]);
    expect(stepped.figure?.size).toBeLessThan(100);
    expect(stepped.figure?.fits).toBe(true);

    const never = layoutFact({ ...wide, value: '1,234,567,890' }, FACT_COLUMNS[1]);
    expect(never.figure).toMatchObject({ size: 72, fits: false });

    const unknown = modelOf(RUN_AGAINST_FIXTURES.allUnknown).facts;
    const drawn = draw(FactsRegion({ facts: unknown, colors: COLORS, ground: 'paper' }));
    expect(linesOf(drawn).filter((line) => line.props.fontWeight === BOLD.fontWeight)).toEqual([]);
    const phrases = linesOf(drawn).filter((line) => line.text === 'not known yet');
    expect(phrases.map((line) => line.props)).toEqual([
      { x: 66, y: 1054, ...MEDIUM, fontSize: 56, fill: 'c-text' },
      { x: 576, y: 1054, ...MEDIUM, fontSize: 56, fill: 'c-text' },
    ]);
  });
});
