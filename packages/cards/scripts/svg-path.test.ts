import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePathData, pathExtent, pathNumbers, PathParseError } from './svg-path.ts';

const ISSUES_FOLDER = join(import.meta.dirname, '..', 'art', 'issues');

/** The `d` values of an art source, read with the same double-quoted form the sources use. */
function pathData(svg: string): string[] {
  return [...svg.matchAll(/\sd="([^"]*)"/g)].map((match) => match[1] ?? '');
}

/** What `run` throws, or null when it returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('parsePathData', () => {
  it('parses absolute and relative commands', () => {
    const segments = parsePathData('M12 2.5 22 12h-3v9.5h-5V15');
    expect(segments.map((segment) => segment.to)).toEqual([
      { x: 12, y: 2.5 },
      { x: 22, y: 12 },
      { x: 19, y: 12 },
      { x: 19, y: 21.5 },
      { x: 14, y: 21.5 },
      { x: 14, y: 15 },
    ]);
    expect(segments.map((segment) => segment.command)).toEqual(['M', 'L', 'H', 'V', 'H', 'V']);
  });

  it('reads compact arc flags', () => {
    const arcs = parsePathData('M5 5a1 1 0 01 1 1').filter((segment) => segment.arc !== null);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.arc).toEqual({ rx: 1, ry: 1, rotation: 0, largeArc: 0, sweep: 1 });
    expect(arcs[0]?.to).toEqual({ x: 6, y: 6 });
  });

  it('reads the spaced arc flags of the sources', () => {
    const [, arc] = parsePathData('M10.5 5.1a1.3 1.3 0 1 0 2.6 0');
    expect(arc?.arc).toEqual({ rx: 1.3, ry: 1.3, rotation: 0, largeArc: 1, sweep: 0 });
    expect(arc?.to.x).toBeCloseTo(13.1, 10);
    expect(arc?.to.y).toBeCloseTo(5.1, 10);
  });

  it('closes a subpath back to its start', () => {
    const segments = parsePathData('M2 3h4v4zm1 1h1');
    expect(segments[3]).toMatchObject({ command: 'Z', to: { x: 2, y: 3 } });
    // a relative move after a close starts from the subpath's start
    expect(segments[4]?.to).toEqual({ x: 3, y: 4 });
  });

  it('reads numbers with signs, exponents and run-together decimals', () => {
    const segments = parsePathData('M1e1-2.5L.5.5');
    expect(segments.map((segment) => segment.to)).toEqual([
      { x: 10, y: -2.5 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it('reflects the control point of a smooth curve', () => {
    const [, , smooth] = parsePathData('M0 0C0 4 4 4 4 0S8 -4 8 0');
    expect(smooth?.controls[0]).toEqual({ x: 4, y: -4 });
  });

  it('rejects garbage', () => {
    const error = thrownBy(() => parsePathData('M1 1 L x'));
    expect(error).toBeInstanceOf(PathParseError);
    expect(error).toMatchObject({ position: 7 });
  });

  it('rejects path data that does not start with a move', () => {
    expect(() => parsePathData('L1 1')).toThrow(PathParseError);
  });

  it('rejects a command with too few numbers', () => {
    expect(() => parsePathData('M1 1 L2')).toThrow(PathParseError);
    expect(() => parsePathData('M1 1 a1 1 0 2 0 3 3')).toThrow(PathParseError);
  });

  it('rejects a number after a close', () => {
    expect(() => parsePathData('M1 1h2z 3 4')).toThrow(PathParseError);
  });
});

describe('pathExtent', () => {
  it('arc extent uses the centre', () => {
    expect(pathExtent(parsePathData('M4 15.5a8 8 0 0 1 16 0z'))).toEqual({
      minX: 4,
      maxX: 20,
      minY: 7.5,
      maxY: 23.5,
    });
  });

  it('cubic control points count', () => {
    expect(pathExtent(parsePathData('M4 20C4 10.5 10.5 4 20 4'))).toEqual({
      minX: 4,
      maxX: 20,
      minY: 4,
      maxY: 20,
    });
  });

  it('scales radii that are too small to reach the end point', () => {
    // A radius of 1 cannot span 10 units, so it is scaled to 5 and the centre is the midpoint.
    const box = pathExtent(parsePathData('M0 10a1 1 0 0 1 10 0'));
    expect(box.minX).toBeCloseTo(0, 10);
    expect(box.maxX).toBeCloseTo(10, 10);
    expect(box.minY).toBeCloseTo(5, 10);
    expect(box.maxY).toBeCloseTo(15, 10);
  });

  it('every reference icon fits its grid', () => {
    const files = readdirSync(ISSUES_FOLDER).filter((file) => file.endsWith('.svg'));
    expect(files).toHaveLength(19);
    for (const file of files) {
      const values = pathData(readFileSync(join(ISSUES_FOLDER, file), 'utf8'));
      expect(values.length, file).toBeGreaterThan(0);
      for (const d of values) {
        const box = pathExtent(parsePathData(d));
        expect(box.minX, file).toBeGreaterThanOrEqual(0);
        expect(box.minY, file).toBeGreaterThanOrEqual(0);
        expect(box.maxX, file).toBeLessThanOrEqual(24);
        expect(box.maxY, file).toBeLessThanOrEqual(24);
      }
    }
  });
});

describe('pathNumbers', () => {
  it('lists every number as written and marks the arc flags', () => {
    expect(pathNumbers('M2.500 3a1 1 0 01 1 1')).toEqual([
      { text: '2.500', isArcFlag: false },
      { text: '3', isArcFlag: false },
      { text: '1', isArcFlag: false },
      { text: '1', isArcFlag: false },
      { text: '0', isArcFlag: false },
      { text: '0', isArcFlag: true },
      { text: '1', isArcFlag: true },
      { text: '1', isArcFlag: false },
      { text: '1', isArcFlag: false },
    ]);
  });
});
