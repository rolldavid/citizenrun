import { ISSUE_IDS } from '@citizenrun/shared';
import {
  ART_RULES,
  CROP_RANGE,
  FORBIDDEN_ATTRIBUTE_PREFIXES,
  FORBIDDEN_ATTRIBUTES,
  SPOT_SIZE,
} from './art-rules.ts';
import type { ArtElement, ArtGroup, ArtGroupRules } from './art-rules.ts';
import { parsePathData, pathExtent, pathNumbers, PathParseError } from './svg-path.ts';
import type { PathBox } from './svg-path.ts';

// CARD-art-rules: the lint over the art sources. It reads the restricted grammar the sources are
// written in (one root, self-closing children, double-quoted attributes) without an XML library, and
// takes text, not files.

export type ArtRule =
  | 'file-name'
  | 'markup'
  | 'root'
  | 'root-attribute'
  | 'element'
  | 'attribute'
  | 'forbidden'
  | 'fill'
  | 'element-limit'
  | 'number'
  | 'extent'
  | 'crop'
  | 'spot'
  | 'id';
export type ArtViolation = { file: string; rule: ArtRule; message: string };

type Attribute = { name: string; value: string };
type Child = { name: string; attributes: readonly Attribute[]; position: number };
type Source = { rootAttributes: readonly Attribute[]; children: readonly Child[] };
type ReadResult =
  { ok: true; source: Source } | { ok: false; rule: 'markup' | 'element'; message: string };

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.svg$/;
const NAME = /[A-Za-z_][-A-Za-z0-9_.:]*/y;
const WHITESPACE = /\s/;
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISSUE_ID_SET: ReadonlySet<string> = new Set(ISSUE_IDS);

class MarkupError extends Error {}

/** Reads the restricted grammar. A child written with content stops the read as an element problem. */
function readSource(text: string): ReadResult {
  let position = 0;
  const skipWhitespace = (): void => {
    while (position < text.length && WHITESPACE.test(text.charAt(position))) {
      position += 1;
    }
  };
  const fail = (message: string): never => {
    throw new MarkupError(message);
  };
  const expect = (literal: string, what: string): void => {
    if (!text.startsWith(literal, position)) {
      fail(`expected ${what} at character ${String(position + 1)}`);
    }
    position += literal.length;
  };
  const readName = (what: string): string => {
    NAME.lastIndex = position;
    const match = NAME.exec(text);
    if (match === null) {
      return fail(`expected ${what} at character ${String(position + 1)}`);
    }
    position += match[0].length;
    return match[0];
  };
  // Attributes up to `>` or `/>`; returns whether the tag closed itself.
  const readAttributes = (): { attributes: Attribute[]; selfClosing: boolean } => {
    const attributes: Attribute[] = [];
    for (;;) {
      const hadSpace = position < text.length && WHITESPACE.test(text.charAt(position));
      skipWhitespace();
      if (text.startsWith('/>', position)) {
        position += 2;
        return { attributes, selfClosing: true };
      }
      if (text.startsWith('>', position)) {
        position += 1;
        return { attributes, selfClosing: false };
      }
      if (!hadSpace) {
        fail(`expected whitespace before an attribute at character ${String(position + 1)}`);
      }
      const name = readName('an attribute name');
      expect('=', `"=" after ${name}`);
      if (text.charAt(position) !== '"') {
        fail(`the value of ${name} is not in double quotes`);
      }
      position += 1;
      const end = text.indexOf('"', position);
      if (end === -1) {
        fail(`the value of ${name} is not closed`);
      }
      const value = text.slice(position, end);
      if (value.includes('<')) {
        fail(`the value of ${name} contains "<"`);
      }
      position = end + 1;
      if (attributes.some((attribute) => attribute.name === name)) {
        fail(`the attribute ${name} is written twice`);
      }
      attributes.push({ name, value });
    }
  };

  try {
    skipWhitespace();
    expect('<svg', 'the root element <svg>');
    const root = readAttributes();
    if (root.selfClosing) {
      fail('the root element has no children');
    }
    const children: Child[] = [];
    for (;;) {
      skipWhitespace();
      if (position >= text.length) {
        fail('the root element is not closed');
      }
      if (text.startsWith('</svg>', position)) {
        position += '</svg>'.length;
        break;
      }
      if (text.startsWith('<!--', position)) {
        const end = text.indexOf('-->', position + 4);
        if (end === -1) {
          fail('a comment is not closed');
        }
        if (text.slice(position + 4, end).includes('<')) {
          fail('a comment contains markup');
        }
        position = end + 3;
        continue;
      }
      if (text.charAt(position) !== '<' || !/[A-Za-z_]/.test(text.charAt(position + 1))) {
        fail(`unexpected content at character ${String(position + 1)}`);
      }
      position += 1;
      const name = readName('an element name');
      const { attributes, selfClosing } = readAttributes();
      const index = children.length + 1;
      if (!selfClosing) {
        return {
          ok: false,
          rule: 'element',
          message: `element ${String(index)} (${name}) has content; only self-closing shapes are allowed`,
        };
      }
      children.push({ name, attributes, position: index });
    }
    skipWhitespace();
    if (position < text.length) {
      fail(`unexpected content after the root element at character ${String(position + 1)}`);
    }
    return { ok: true, source: { rootAttributes: root.attributes, children } };
  } catch (error) {
    if (error instanceof MarkupError) {
      return { ok: false, rule: 'markup', message: error.message };
    }
    throw error;
  }
}

function isForbidden(name: string): boolean {
  return (
    FORBIDDEN_ATTRIBUTES.includes(name) ||
    FORBIDDEN_ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function isArtElement(rules: ArtGroupRules, name: string): name is ArtElement {
  return Object.hasOwn(rules.elements, name);
}

function attributeOf(attributes: readonly Attribute[], name: string): string | undefined {
  return attributes.find((attribute) => attribute.name === name)?.value;
}

function label(child: Child): string {
  return `element ${String(child.position)} (${child.name})`;
}

/** The numeric attributes of a shape element; a path's numbers are in its data. */
const NUMERIC_ATTRIBUTES: Readonly<Partial<Record<ArtElement, readonly string[]>>> = {
  rect: ['x', 'y', 'width', 'height'],
  circle: ['cx', 'cy', 'r'],
};

function decimals(text: string): number {
  const mantissa = text.split(/[eE]/)[0] ?? text;
  const point = mantissa.indexOf('.');
  return point === -1 ? 0 : mantissa.length - point - 1;
}

function numberProblem(text: string, numbers: ArtGroupRules['numbers']): string | null {
  const value = Number(text);
  if (numbers === 'half-units') {
    return Number.isInteger(value * 2) ? null : `${text} is not a multiple of 0.5`;
  }
  if (/[eE]/.test(text)) {
    const scaled = value * 1000;
    return Math.abs(scaled - Math.round(scaled)) < 1e-9
      ? null
      : `${text} has more than three decimals`;
  }
  return decimals(text) > 3 ? `${text} has more than three decimals` : null;
}

/** A shape's box, or a reason it has none. */
function shapeBox(child: Child): PathBox | string | null {
  const get = (name: string): number | null => {
    const value = attributeOf(child.attributes, name);
    return value !== undefined && PLAIN_NUMBER.test(value) ? Number(value) : null;
  };
  switch (child.name) {
    case 'rect': {
      const [x, y, width, height] = [get('x'), get('y'), get('width'), get('height')];
      if (x === null || y === null || width === null || height === null) return null;
      return { minX: x, maxX: x + width, minY: y, maxY: y + height };
    }
    case 'circle': {
      const [cx, cy, r] = [get('cx'), get('cy'), get('r')];
      if (cx === null || cy === null || r === null) return null;
      return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r };
    }
    case 'path': {
      const d = attributeOf(child.attributes, 'd');
      if (d === undefined) return null;
      try {
        return pathExtent(parsePathData(d));
      } catch (error) {
        if (error instanceof PathParseError) return error.message;
        throw error;
      }
    }
    default:
      return null;
  }
}

function twoNumbers(text: string): [number, number] | null {
  const parts = text.trim().split(/\s+/);
  const [a, b] = parts;
  if (parts.length !== 2 || a === undefined || b === undefined) return null;
  if (!PLAIN_NUMBER.test(a) || !PLAIN_NUMBER.test(b)) return null;
  return [Number(a), Number(b)];
}

/**
 * Every violation of the art rules in one source file, in the order of the checks; empty when it
 * passes. With `illustrationIds`, an office drawing or a glyph must be named by one of them, and so
 * must the relative its `data-placeholder-of` names (CARD-art-ids).
 */
export function lintArtSource(
  group: ArtGroup,
  fileName: string,
  svgText: string,
  options?: { illustrationIds?: ReadonlySet<string> },
): readonly ArtViolation[] {
  const rules = ART_RULES[group];
  const read = readSource(svgText);
  if (!read.ok) {
    return [{ file: fileName, rule: read.rule, message: read.message }];
  }
  const { rootAttributes, children } = read.source;
  const violations: ArtViolation[] = [];
  const report = (rule: ArtRule, problems: readonly string[]): void => {
    if (problems.length > 0) {
      violations.push({ file: fileName, rule, message: problems.join('; ') });
    }
  };

  // 1. file-name, 2. id
  const isKebab = FILE_NAME.test(fileName);
  report('file-name', isKebab ? [] : [`${fileName} is not a kebab-case .svg name`]);
  if (isKebab && group === 'issues') {
    const id = fileName.slice(0, -'.svg'.length);
    report('id', ISSUE_ID_SET.has(id) ? [] : [`${id} is not an issue id`]);
  }
  const illustrationIds = options?.illustrationIds;
  if (isKebab && group !== 'issues' && illustrationIds !== undefined) {
    const id = fileName.slice(0, -'.svg'.length);
    const relative = attributeOf(rootAttributes, 'data-placeholder-of');
    const problems: string[] = [];
    if (!illustrationIds.has(id)) {
      problems.push(`${id} is not an illustration id of an office type`);
    }
    if (relative !== undefined && !illustrationIds.has(relative)) {
      problems.push(
        `data-placeholder-of "${relative}" is not an illustration id of an office type`,
      );
    }
    if (relative === id) {
      problems.push(`data-placeholder-of "${relative}" names the file itself`);
    }
    report('id', problems);
  }

  // 3. root
  const rootProblems: string[] = [];
  const xmlns = attributeOf(rootAttributes, 'xmlns');
  if (xmlns !== SVG_NAMESPACE) {
    rootProblems.push(`the root xmlns is ${xmlns === undefined ? 'missing' : `"${xmlns}"`}`);
  }
  const viewBox = attributeOf(rootAttributes, 'viewBox');
  if (viewBox !== rules.viewBox) {
    rootProblems.push(
      `the root viewBox is ${viewBox === undefined ? 'missing' : `"${viewBox}"`}, not "${rules.viewBox}"`,
    );
  }
  report('root', rootProblems);

  // 4. root-attribute
  const allowedRoot = new Set([
    'xmlns',
    'viewBox',
    ...rules.rootAttributes.required,
    ...rules.rootAttributes.optional,
  ]);
  report('root-attribute', [
    ...rules.rootAttributes.required
      .filter((name) => attributeOf(rootAttributes, name) === undefined)
      .map((name) => `the root lacks ${name}`),
    ...rootAttributes
      .filter(({ name }) => !allowedRoot.has(name) && !isForbidden(name))
      .map(({ name }) => `the root attribute ${name} is not allowed in the ${group} group`),
  ]);

  // 5. element
  report(
    'element',
    children
      .filter((child) => !isArtElement(rules, child.name))
      .map((child) => `${label(child)} is not allowed in the ${group} group`),
  );

  // 6. forbidden
  report('forbidden', [
    ...rootAttributes
      .filter(({ name }) => isForbidden(name))
      .map(({ name }) => `the root has the forbidden attribute ${name}`),
    ...children.flatMap((child) =>
      child.attributes
        .filter(({ name }) => isForbidden(name))
        .map(({ name }) => `${label(child)} has the forbidden attribute ${name}`),
    ),
  ]);

  // 7. attribute
  report(
    'attribute',
    children.flatMap((child) => {
      const allowed = isArtElement(rules, child.name) ? (rules.elements[child.name] ?? []) : null;
      const problems =
        allowed === null
          ? []
          : child.attributes
              .filter(({ name }) => !isForbidden(name) && !allowed.includes(name))
              .map(({ name }) => `${label(child)} has the attribute ${name}, which is not allowed`);
      if (attributeOf(child.attributes, 'fill') === undefined) {
        problems.push(`${label(child)} has no fill`);
      }
      return problems;
    }),
  );

  // 8. fill
  report(
    'fill',
    children.flatMap((child) => {
      const fill = attributeOf(child.attributes, 'fill');
      return fill === undefined || Object.hasOwn(rules.sentinels, fill)
        ? []
        : [`fill ${fill} is not a sentinel of the ${group} group (${label(child)})`];
    }),
  );

  // 9. element-limit
  report(
    'element-limit',
    children.length > rules.elementLimit
      ? [
          `${String(children.length)} elements; the ${group} group allows ${String(rules.elementLimit)}`,
        ]
      : [],
  );

  // 10. number
  report(
    'number',
    children.flatMap((child) => {
      if (child.name === 'path') {
        const d = attributeOf(child.attributes, 'd');
        if (d === undefined) return [];
        try {
          return pathNumbers(d)
            .filter(({ isArcFlag }) => !isArcFlag)
            .flatMap(({ text }) => {
              const problem = numberProblem(text, rules.numbers);
              return problem === null ? [] : [`${label(child)}: ${problem}`];
            });
        } catch (error) {
          if (error instanceof PathParseError) return [`${label(child)}: ${error.message}`];
          throw error;
        }
      }
      const names = isArtElement(rules, child.name) ? (NUMERIC_ATTRIBUTES[child.name] ?? []) : [];
      return names.flatMap((name) => {
        const value = attributeOf(child.attributes, name);
        if (value === undefined) return [`${label(child)} lacks ${name}`];
        if (!PLAIN_NUMBER.test(value))
          return [`${label(child)}: ${name} "${value}" is not a number`];
        const problem = numberProblem(value, rules.numbers);
        return problem === null ? [] : [`${label(child)}: ${name} ${problem}`];
      });
    }),
  );

  // 11. extent
  const { extent } = rules;
  report(
    'extent',
    children.flatMap((child) => {
      if (!isArtElement(rules, child.name) || !extent.appliesTo.includes(child.name)) return [];
      const box = shapeBox(child);
      if (box === null || typeof box === 'string') return [];
      const inside =
        box.minX >= extent.minX &&
        box.maxX <= extent.maxX &&
        box.minY >= extent.minY &&
        box.maxY <= extent.maxY;
      return inside
        ? []
        : [
            `${label(child)} spans x ${String(box.minX)} to ${String(box.maxX)} and y ${String(box.minY)} to ${String(box.maxY)}, outside x ${String(extent.minX)} to ${String(extent.maxX)} and y ${String(extent.minY)} to ${String(extent.maxY)}`,
          ];
    }),
  );

  if (group === 'offices') {
    // 12. crop
    const crop = attributeOf(rootAttributes, 'data-crop');
    if (crop !== undefined) {
      const value = PLAIN_NUMBER.test(crop) ? Number(crop) : Number.NaN;
      const fits =
        value >= CROP_RANGE.min &&
        value <= CROP_RANGE.max &&
        Number.isInteger((value - CROP_RANGE.min) / CROP_RANGE.step);
      report(
        'crop',
        fits
          ? []
          : [
              `data-crop "${crop}" is not from ${String(CROP_RANGE.min)} to ${String(CROP_RANGE.max)} in steps of ${String(CROP_RANGE.step)}`,
            ],
      );
    }

    // 13. spot
    report('spot', spotProblems(rules, rootAttributes, children));
  }

  return violations;
}

function spotProblems(
  rules: ArtGroupRules,
  rootAttributes: readonly Attribute[],
  children: readonly Child[],
): string[] {
  const spotFill = Object.keys(rules.sentinels).find((hex) => rules.sentinels[hex] === 'spot');
  const spots = children.filter((child) => attributeOf(child.attributes, 'fill') === spotFill);
  if (spots.length !== 1) {
    return [`${String(spots.length)} elements have the spot fill; exactly one must`];
  }
  const declared = attributeOf(rootAttributes, 'data-spot');
  if (declared === undefined) {
    return [];
  }
  const size = twoNumbers(declared);
  if (size === null) {
    return [`data-spot "${declared}" is not two numbers`];
  }
  const problems: string[] = [];
  const [width, height] = size;
  const longer = Math.max(width, height);
  const shorter = Math.min(width, height);
  if (longer < SPOT_SIZE.longMin || longer > SPOT_SIZE.longMax) {
    problems.push(
      `the spot's longer side is ${String(longer)}, not ${String(SPOT_SIZE.longMin)} to ${String(SPOT_SIZE.longMax)}`,
    );
  }
  if (shorter < SPOT_SIZE.shortMin) {
    problems.push(
      `the spot's shorter side is ${String(shorter)}, under ${String(SPOT_SIZE.shortMin)}`,
    );
  }
  const [spot] = spots;
  if (spot !== undefined) {
    const read = (name: string): number | null => {
      const value = attributeOf(spot.attributes, name);
      return value !== undefined && PLAIN_NUMBER.test(value) ? Number(value) : null;
    };
    if (spot.name === 'rect' && (read('width') !== width || read('height') !== height)) {
      problems.push(`data-spot "${declared}" is not the spot rect's width and height`);
    }
    if (spot.name === 'circle') {
      const r = read('r');
      if (r === null || 2 * r !== width || 2 * r !== height) {
        problems.push(`data-spot "${declared}" is not the spot circle's diameter twice`);
      }
    }
  }
  return problems;
}
