import { beforeAll, describe, expect, it } from 'vitest';
import { G, Rect, Svg, Text } from '@citizenrun/cards/primitives';
import { FIXTURE_CTX, RUN_AGAINST_FIXTURES } from '../__fixtures__/office.fixtures.ts';
import type { CanvasPage } from '../feed.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { altText } from '../model/run-against.ts';
import type { RunAgainstData } from '../model/run-against.ts';
import { BOLD, COLORS, modelOf, t } from '../regions/testing/support.ts';
import { draw, linesOf, walk } from '../regions/testing/tree.ts';
import type { Drawn } from '../regions/testing/tree.ts';
import { CardCanvas } from './card-canvas.tsx';

beforeAll(() => {
  setStrictGlyphs(true);
});

function pageOf(data: RunAgainstData): CanvasPage {
  return {
    key: 'run_against',
    officeId: data.office.id,
    template: 'run_against',
    model: modelOf(data),
    alt: altText(data, t, FIXTURE_CTX),
  };
}

function canvasOf(data: RunAgainstData, width = 540): Drawn {
  const [root] = draw(<CardCanvas page={pageOf(data)} colors={COLORS} width={width} />);
  if (root === undefined) {
    throw new Error('The canvas drew nothing.');
  }
  return root;
}

describe('CardCanvas', () => {
  it('one page', () => {
    const root = canvasOf(RUN_AGAINST_FIXTURES.known);
    expect(root.type).toBe(Svg);
    expect(root.props).toEqual({
      width: 540,
      height: 675,
      viewBox: '0 0 1080 1350',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
    expect(root.children[0]?.type).toBe(Rect);
    expect(root.children[0]?.props).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1350,
      fill: 'c-surface',
    });
    // The drawing comes right after the paper, under every line of text.
    expect(root.children[1]?.type).toBe(G);
    expect(canvasOf(RUN_AGAINST_FIXTURES.known, 375).props).toMatchObject({
      width: 375,
      height: 468.8,
    });
  });

  it('draws the known card top to bottom', () => {
    const root = canvasOf(RUN_AGAINST_FIXTURES.known);
    expect(linesOf([root]).map((line) => line.text)).toEqual([
      'PROPERTY TAXES',
      'County',
      'Treasurer',
      'Fixture Wren County, ZZ',
      'Election Apr 6, 2027',
      'Carol Wynn',
      'holder since 2019',
      '$52,900',
      'a year · about 20 hours a week',
      'about',
      '2,100',
      'VOTES TO WIN',
      '12',
      'DAYS TO FILE',
      'closes Fri, Nov 27',
      'Pay: wrencounty.example, Nov 9.',
      'Filing: wrencounty.example, Nov 9.',
    ]);
    const sources = linesOf([root]).slice(-2);
    expect(sources.map((line) => line.props)).toEqual([
      {
        x: 66,
        y: 1240,
        fontFamily: 'Chivo Mono',
        fontWeight: '500',
        fontSize: 40,
        fill: 'c-text-secondary',
      },
      {
        x: 66,
        y: 1288,
        fontFamily: 'Chivo Mono',
        fontWeight: '500',
        fontSize: 40,
        fill: 'c-text-secondary',
      },
    ]);
  });

  it('says unknown once in each slot, and never heavy', () => {
    const root = canvasOf(RUN_AGAINST_FIXTURES.allUnknown);
    const lines = linesOf([root]);
    expect(lines.map((line) => line.text)).toEqual([
      'COUNTY OFFICE',
      'County',
      'Treasurer',
      'Fixture Wren County, ZZ',
      'Election Apr 6, 2027',
      'not known yet',
      'pay',
      'not known yet',
      'VOTES TO WIN',
      'not known yet',
      'DAYS TO FILE',
    ]);
    expect(lines.filter((line) => line.props.fontWeight === BOLD.fontWeight)).toEqual([]);
  });

  it('is a still of plain marks on every fixture', () => {
    for (const data of Object.values(RUN_AGAINST_FIXTURES)) {
      const all = walk([canvasOf(data)]);
      // While tracked text is switched off no line carries a letter spacing.
      expect(all.filter((node) => 'letterSpacing' in node.props)).toEqual([]);
      for (const node of all) {
        // One string per line of text: a line never holds another element.
        if (node.type === Text) {
          expect(node.text).not.toBeNull();
          expect(node.children).toEqual([]);
        }
        for (const [name, value] of Object.entries(node.props)) {
          expect(name.startsWith('on')).toBe(false);
          if (typeof value === 'number') {
            expect(Math.round(value * 10) / 10).toBe(value);
          }
        }
      }
    }
  });

  it('draws the same tree twice', () => {
    expect(canvasOf(RUN_AGAINST_FIXTURES.known)).toEqual(canvasOf(RUN_AGAINST_FIXTURES.known));
  });
});
