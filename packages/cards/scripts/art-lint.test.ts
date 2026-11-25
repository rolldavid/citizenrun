import { describe, expect, it } from 'vitest';
import { lintArtSource } from './art-lint.ts';
import type { ArtRule } from './art-lint.ts';

// Each hostile fixture differs from a valid one in one way and must fail exactly one rule.

const CLIMATE_PATH =
  'M4 20C4 10.500 10.500 4 20 4c0 9.500-6.500 16-16 16zm2.700-3.800 1.100 1.100 8.600-8.600-1.100-1.100z';

function issue(
  options: { root?: string; paths?: readonly string[]; before?: string } = {},
): string {
  const root = options.root ?? 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"';
  const paths = options.paths ?? [`<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/>`];
  return `${options.before ?? ''}<svg ${root}>\n  ${paths.join('\n  ')}\n</svg>\n`;
}

const OFFICE_SHAPES: readonly string[] = [
  '<rect x="8" y="88" width="80" height="3" fill="#111111"/>',
  '<path d="M20 20h10v40H20z" fill="#111111"/>',
  '<circle cx="40" cy="40" r="14" fill="#7A7A7A"/>',
  '<rect x="60" y="50" width="8" height="24" fill="#D93A1E"/>',
];

function office(options: { root?: string; shapes?: readonly string[] } = {}): string {
  const root =
    options.root ??
    'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="80" data-spot="8 24"';
  return `<svg ${root}>\n  ${(options.shapes ?? OFFICE_SHAPES).join('\n  ')}\n</svg>\n`;
}

function rulesOf(group: 'issues' | 'offices', fileName: string, text: string): ArtRule[] {
  return lintArtSource(group, fileName, text).map((violation) => violation.rule);
}

describe('lintArtSource', () => {
  it('passes the valid issue fixture', () => {
    expect(lintArtSource('issues', 'climate.svg', issue())).toEqual([]);
  });

  it('passes the valid office fixture', () => {
    expect(lintArtSource('offices', 'county-treasurer.svg', office())).toEqual([]);
  });

  it('a stroke fails', () => {
    const text = issue({
      paths: [`<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111" stroke="#111111"/>`],
    });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['forbidden']);
  });

  it('a fifth color fails', () => {
    const shapes = OFFICE_SHAPES.map((shape) => shape.replace('#7A7A7A', '#123456'));
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes }))).toEqual(['fill']);
  });

  it('thirteen elements fail', () => {
    const extra = Array.from({ length: 9 }, (_, index) => {
      const x = String(10 + index * 4);
      return `<rect x="${x}" y="4" width="2" height="2" fill="#111111"/>`;
    });
    const shapes = [...OFFICE_SHAPES, ...extra];
    expect(shapes).toHaveLength(13);
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes }))).toEqual([
      'element-limit',
    ]);
  });

  it('twelve elements pass for an office', () => {
    const extra = Array.from({ length: 8 }, (_, index) => {
      const x = String(10 + index * 4);
      return `<rect x="${x}" y="4" width="2" height="2" fill="#111111"/>`;
    });
    expect(
      rulesOf('offices', 'county-treasurer.svg', office({ shapes: [...OFFICE_SHAPES, ...extra] })),
    ).toEqual([]);
  });

  it('five paths fail for an issue', () => {
    const paths = Array.from({ length: 5 }, () => '<path d="M2 2h4v4H2z" fill="#111111"/>');
    expect(rulesOf('issues', 'climate.svg', issue({ paths }))).toEqual(['element-limit']);
  });

  it('two spots fail', () => {
    const shapes = [...OFFICE_SHAPES, '<rect x="30" y="70" width="8" height="12" fill="#D93A1E"/>'];
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes }))).toEqual(['spot']);
  });

  it('a spot 4 units wide fails', () => {
    const shapes = OFFICE_SHAPES.map((shape) =>
      shape.includes('#D93A1E')
        ? '<rect x="60" y="50" width="4" height="20" fill="#D93A1E"/>'
        : shape,
    );
    const root =
      'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="80" data-spot="4 20"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root, shapes }))).toEqual(['spot']);
  });

  it('a declared spot size that is not the spot rect fails', () => {
    const root =
      'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="80" data-spot="24 8"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root }))).toEqual(['spot']);
  });

  it('a circle spot is declared by its diameter', () => {
    const shapes = OFFICE_SHAPES.map((shape) =>
      shape.includes('#D93A1E') ? '<circle cx="70" cy="60" r="6" fill="#D93A1E"/>' : shape,
    );
    const good =
      'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="80" data-spot="12 12"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root: good, shapes }))).toEqual([]);
    const bad =
      'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="80" data-spot="12 10"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root: bad, shapes }))).toEqual([
      'spot',
    ]);
  });

  it('a crop line of 60 fails', () => {
    const root =
      'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="60" data-spot="8 24"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root }))).toEqual(['crop']);
  });

  it('a crop line between half units fails', () => {
    const root =
      'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-crop="80.25" data-spot="8 24"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root }))).toEqual(['crop']);
  });

  it('a transform fails', () => {
    const text = issue({
      paths: [
        `<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111" transform="scale(2)"/>`,
      ],
    });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['forbidden']);
  });

  it('a style element fails', () => {
    const text = issue({
      paths: [
        '<style>path { fill: red }</style>',
        `<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/>`,
      ],
    });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['element']);
  });

  it('a group fails', () => {
    const text = issue({
      paths: [`<g><path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/></g>`],
    });
    const violations = lintArtSource('issues', 'climate.svg', text);
    expect(violations.map((violation) => violation.rule)).toEqual(['element']);
    expect(violations[0]?.message).toContain('(g)');
  });

  it('a self-closing element of another kind fails', () => {
    const text = issue({
      paths: [
        '<circle cx="12" cy="12" r="4" fill="#111111"/>',
        `<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/>`,
      ],
    });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['element']);
  });

  it('an XML declaration fails', () => {
    expect(rulesOf('issues', 'climate.svg', issue({ before: '<?xml version="1.0"?>\n' }))).toEqual([
      'markup',
    ]);
  });

  it('a single-quoted value fails', () => {
    const text = issue({
      paths: [`<path fill-rule='evenodd' d="${CLIMATE_PATH}" fill="#111111"/>`],
    });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['markup']);
  });

  it('a comment holding markup fails and a plain comment passes', () => {
    const shape = `<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/>`;
    expect(rulesOf('issues', 'climate.svg', issue({ paths: ['<!-- a leaf -->', shape] }))).toEqual(
      [],
    );
    expect(rulesOf('issues', 'climate.svg', issue({ paths: ['<!-- <g> -->', shape] }))).toEqual([
      'markup',
    ]);
  });

  it('text outside an element fails', () => {
    const shape = `<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/>`;
    expect(rulesOf('issues', 'climate.svg', issue({ paths: ['leaf', shape] }))).toEqual(['markup']);
  });

  it('an unclosed root fails', () => {
    expect(rulesOf('issues', 'climate.svg', issue().replace('</svg>', ''))).toEqual(['markup']);
  });

  it('a file name that is no id fails', () => {
    expect(rulesOf('issues', 'not-an-issue.svg', issue())).toEqual(['id']);
  });

  it('a file name that is not kebab case fails', () => {
    expect(rulesOf('issues', 'Rent_Housing.svg', issue())).toEqual(['file-name']);
  });

  it('a wrong view box fails', () => {
    const root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"';
    expect(rulesOf('issues', 'climate.svg', issue({ root }))).toEqual(['root']);
  });

  it('a missing namespace fails', () => {
    expect(rulesOf('issues', 'climate.svg', issue({ root: 'viewBox="0 0 24 24"' }))).toEqual([
      'root',
    ]);
  });

  it('a root data attribute fails for an issue', () => {
    const root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-crop="80"';
    expect(rulesOf('issues', 'climate.svg', issue({ root }))).toEqual(['root-attribute']);
  });

  it('an office without its crop line fails', () => {
    const root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" data-spot="8 24"';
    expect(rulesOf('offices', 'county-treasurer.svg', office({ root }))).toEqual([
      'root-attribute',
    ]);
  });

  it('four decimals fail', () => {
    const text = issue({ paths: ['<path d="M2.1234 2h4v4H2z" fill="#111111"/>'] });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['number']);
  });

  it('a half-unit rule applies to offices', () => {
    const shapes = OFFICE_SHAPES.map((shape) => shape.replace('x="8"', 'x="2.25"'));
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes }))).toEqual(['number']);
  });

  it('an office path with compact arc flags passes', () => {
    const shapes = [
      ...OFFICE_SHAPES.slice(0, 3),
      '<path d="M60 50a5 5 0 01 10 0z" fill="#111111"/>',
    ];
    const withSpot = [...shapes, OFFICE_SHAPES[3] ?? ''];
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes: withSpot }))).toEqual([]);
  });

  it('a shape outside the grid fails', () => {
    const text = issue({ paths: ['<path d="M-1 0h4v4h-4z" fill="#111111"/>'] });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['extent']);
  });

  it('an office rect past the side margin fails', () => {
    const shapes = OFFICE_SHAPES.map((shape) =>
      shape.replace('x="8" y="88" width="80"', 'x="1" y="88" width="80"'),
    );
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes }))).toEqual(['extent']);
  });

  it('a short hex fails', () => {
    const text = issue({ paths: [`<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111"/>`] });
    const violations = lintArtSource('issues', 'climate.svg', text);
    expect(violations.map((violation) => violation.rule)).toEqual(['fill']);
    expect(violations[0]?.message).toContain('fill #111 is not a sentinel of the issues group');
  });

  it('a lower-case sentinel fails', () => {
    const shapes = OFFICE_SHAPES.map((shape) => shape.replace('#7A7A7A', '#7a7a7a'));
    expect(rulesOf('offices', 'county-treasurer.svg', office({ shapes }))).toEqual(['fill']);
  });

  it('a shape with no fill fails', () => {
    const text = issue({ paths: [`<path fill-rule="evenodd" d="${CLIMATE_PATH}"/>`] });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['attribute']);
  });

  it('an attribute outside the element list fails', () => {
    const text = issue({
      paths: [`<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111" data-name="leaf"/>`],
    });
    expect(rulesOf('issues', 'climate.svg', text)).toEqual(['attribute']);
  });

  it('reports several broken rules in check order', () => {
    const text = issue({
      root: 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"',
      paths: ['<path d="M-1 0h4v4h-4z" fill="#111" stroke="#111111"/>'],
    });
    expect(rulesOf('issues', 'Bad.svg', text)).toEqual([
      'file-name',
      'root',
      'forbidden',
      'fill',
      'extent',
    ]);
  });

  it('names the element by position and no path', () => {
    const text = issue({
      paths: [
        `<path fill-rule="evenodd" d="${CLIMATE_PATH}" fill="#111111"/>`,
        '<path d="M2 2h4v4H2z" fill="#222222"/>',
      ],
    });
    const [violation] = lintArtSource('issues', 'climate.svg', text);
    expect(violation).toEqual({
      file: 'climate.svg',
      rule: 'fill',
      message: 'fill #222222 is not a sentinel of the issues group (element 2 (path))',
    });
  });
});
