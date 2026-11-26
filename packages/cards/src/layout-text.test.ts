import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CANVAS, round1 } from './canvas.ts';
import {
  baselineFromCapTop,
  clipText,
  fitNumber,
  fitOneLine,
  fitWrapped,
  layoutText,
  measureText,
  setStrictGlyphs,
  UndrawableTextError,
} from './layout-text.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

afterEach(() => {
  setStrictGlyphs(true);
});

const BIG = CANVAS.type.bigNumber;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/** True when the string holds no lone surrogate. */
function wellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ''));
}

describe('layout text', () => {
  it('fits the worked numbers', () => {
    expect(fitNumber('$52,900', CANVAS.measure, BIG)).toBe(237);
    expect(round1(measureText('$52,900', { face: 'bold', size: 237 }))).toBe(947.3);
    expect(fitNumber('$131,000', CANVAS.measure, BIG)).toBe(224);
    expect(fitNumber('$1,250,000', CANVAS.measure, BIG)).toBe(177);
    expect(fitNumber('$0', CANVAS.measure, BIG)).toBe(330);
    expect(fitNumber('$100', CANVAS.measure, BIG)).toBe(330);
  });

  it('never fits a figure under its minimum', () => {
    expect(fitNumber('$1,250,000,000,000', CANVAS.measure, BIG)).toBe(BIG.min);
  });

  it('wraps the long title', () => {
    expect(
      fitWrapped(
        'Soil and Water Conservation District Supervisor',
        'medium',
        CANVAS.type.title,
        484,
      ),
    ).toEqual({
      size: 64,
      lines: ['Soil and Water', 'Conservation', 'District', 'Supervisor'],
      cut: false,
    });
  });

  it('takes the first step that fits', () => {
    const fitted = fitWrapped('County Treasurer', 'medium', CANVAS.type.title, CANVAS.measure);
    expect(fitted).toEqual({ size: 92, lines: ['County Treasurer'], cut: false });
  });

  it('measures the mono', () => {
    expect(measureText('x'.repeat(39), { face: 'mono', size: 40 })).toBe(936);
  });

  it('adds tracking between code points only', () => {
    const plain = measureText('ABC', { face: 'mono', size: 40 });
    expect(measureText('ABC', { face: 'mono', size: 40, tracking: 0.04 })).toBeCloseTo(
      plain + 2 * 0.04 * 40,
      9,
    );
    expect(measureText('ABC', { face: 'mono', size: 40, tracking: -0.03 })).toBeCloseTo(
      plain - 2 * 0.03 * 40,
      9,
    );
    expect(measureText('', { face: 'mono', size: 40, tracking: 0.04 })).toBe(0);
  });

  it('cuts a word wider than the measure', () => {
    const result = layoutText(
      'Supercalifragilisticexpialidocious',
      { face: 'medium', size: 92 },
      300,
      2,
    );
    expect(result.cut).toBe(true);
    expect(result.lines).toHaveLength(1);
    const [line = ''] = result.lines;
    expect(line.endsWith('…')).toBe(true);
    expect(measureText(line, { face: 'medium', size: 92 })).toBeLessThanOrEqual(300);
  });

  it('keeps the last line for the rest', () => {
    const style = { face: 'medium', size: 92 } as const;
    const text = 'Board of Supervisors of the Fixture Wren County Water District';
    expect(layoutText(text, style, 600, 9).lines.length).toBeGreaterThanOrEqual(4);
    const result = layoutText(text, style, 600, 2);
    expect(result.cut).toBe(true);
    expect(result.lines).toHaveLength(2);
    const [first = '', second = ''] = result.lines;
    expect(first).toBe(layoutText(text, style, 600, 9).lines[0]);
    expect(second.endsWith('…')).toBe(true);
    expect(measureText(second, style)).toBeLessThanOrEqual(600);
  });

  it('never splits a surrogate pair', () => {
    setStrictGlyphs(false);
    const text = 'AB\u{1D400}\u{1D400}\u{1D400}\u{1D400}CD';
    for (let width = 60; width <= 400; width += 1) {
      const result = clipText(text, { face: 'medium', size: 92 }, width);
      expect(wellFormed(result), `${String(width)}: ${result}`).toBe(true);
      expect(result === text || result.endsWith('…'), String(width)).toBe(true);
    }
  });

  it('a fit is the same with tracking -0.03 and 0', () => {
    const samples = [
      'County Treasurer',
      'Soil and Water Conservation District Supervisor',
      'Fixture Wren County Board of Education, District 4',
      '$52,900',
      'Register of Deeds',
    ];
    const tracking = CANVAS.track.number;
    for (const text of samples) {
      expect(fitWrapped(text, 'medium', CANVAS.type.title, 484, tracking), text).toEqual(
        fitWrapped(text, 'medium', CANVAS.type.title, 484, 0),
      );
      expect(fitOneLine(text, 'medium', CANVAS.type.bigUnknown, 600, tracking), text).toBe(
        fitOneLine(text, 'medium', CANVAS.type.bigUnknown, 600, 0),
      );
      expect(layoutText(text, { face: 'bold', size: 100, tracking }, 484, 3), text).toEqual(
        layoutText(text, { face: 'bold', size: 100, tracking: 0 }, 484, 3),
      );
    }
  });

  it('counts positive tracking in a fit', () => {
    const text = 'x'.repeat(39);
    expect(fitOneLine(text, 'mono', [40, 36], 936)).toBe(40);
    expect(fitOneLine(text, 'mono', [40, 36], 936, CANVAS.track.caps)).toBe(36);
  });

  it('normalizes white space', () => {
    expect(layoutText('  County\n\tTreasurer ', { face: 'medium', size: 40 }, 948, 2)).toEqual({
      lines: ['County Treasurer'],
      cut: false,
    });
    expect(clipText(' County  Treasurer ', { face: 'medium', size: 40 }, 948)).toBe(
      'County Treasurer',
    );
  });

  it('gives empty results for an empty string', () => {
    expect(layoutText('   ', { face: 'medium', size: 40 }, 948, 2)).toEqual({
      lines: [],
      cut: false,
    });
    expect(clipText('', { face: 'medium', size: 40 }, 948)).toBe('');
    expect(measureText('', { face: 'bold', size: 40 })).toBe(0);
  });

  it('undrawable text throws in tests', () => {
    expect(() => measureText('Nguyễn', { face: 'medium', size: 40 })).toThrow(UndrawableTextError);
    expect(() => measureText('Nguyễn', { face: 'medium', size: 40 })).toThrow('U+1EC5');
    setStrictGlyphs(false);
    expect(measureText('Nguyễn', { face: 'medium', size: 40 })).toBe(
      measureText('Nguynn', { face: 'medium', size: 40 }),
    );
  });

  it('places the first baseline from the cap top', () => {
    expect(baselineFromCapTop(100, 92)).toBe(165.3);
  });
});
