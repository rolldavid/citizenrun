// A reader for SVG path data, for the art lint: it resolves every command to absolute points so the
// lint can check a drawing's extent, and lists every number as written so the lint can check its
// precision.

export type Point = { x: number; y: number };

/** The parameters of an elliptical arc, as written (radii before any scaling). */
export type ArcParameters = {
  rx: number;
  ry: number;
  rotation: number;
  largeArc: 0 | 1;
  sweep: 0 | 1;
};

/** One command of a path, resolved to absolute coordinates. */
export type PathSegment = {
  /** The absolute form of the command. */
  command: 'M' | 'L' | 'H' | 'V' | 'C' | 'S' | 'Q' | 'T' | 'A' | 'Z';
  from: Point;
  to: Point;
  /** Control points, including the reflected ones of `S` and `T`. */
  controls: readonly Point[];
  arc: ArcParameters | null;
};

export type PathBox = { minX: number; maxX: number; minY: number; maxY: number };

/** Path data that does not follow the SVG path grammar; `position` is the index of the first bad character. */
export class PathParseError extends Error {
  readonly position: number;

  constructor(position: number, detail: string) {
    super(`path data cannot be read at position ${String(position)}: ${detail}`);
    this.name = 'PathParseError';
    this.position = position;
  }
}

type NumberToken = { text: string; value: number; isArcFlag: boolean };

const ARGUMENT_COUNT: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WHITESPACE = /\s/;

/** Reads path data into commands with their numbers, as written. Throws `PathParseError`. */
function tokenize(d: string): { letter: string; numbers: NumberToken[] }[] {
  const commands: { letter: string; numbers: NumberToken[] }[] = [];
  let position = 0;

  const skipWhitespace = (): void => {
    while (position < d.length && WHITESPACE.test(d.charAt(position))) {
      position += 1;
    }
  };
  // Between two arguments: whitespace with at most one comma.
  const skipSeparator = (): void => {
    skipWhitespace();
    if (d.charAt(position) === ',') {
      position += 1;
      skipWhitespace();
    }
  };
  const readNumber = (): NumberToken => {
    NUMBER.lastIndex = position;
    const match = NUMBER.exec(d);
    if (match === null) {
      throw new PathParseError(position, `expected a number, found ${describeAt(d, position)}`);
    }
    position += match[0].length;
    return { text: match[0], value: Number(match[0]), isArcFlag: false };
  };
  const readFlag = (): NumberToken => {
    const ch = d.charAt(position);
    if (ch !== '0' && ch !== '1') {
      throw new PathParseError(
        position,
        `expected an arc flag 0 or 1, found ${describeAt(d, position)}`,
      );
    }
    position += 1;
    return { text: ch, value: Number(ch), isArcFlag: true };
  };
  const startsNumber = (): boolean => {
    NUMBER.lastIndex = position;
    return NUMBER.test(d);
  };

  skipWhitespace();
  let previous: string | null = null;
  while (position < d.length) {
    const letter = d.charAt(position);
    const upper = letter.toUpperCase();
    const count = ARGUMENT_COUNT[upper];
    if (count === undefined || !/[a-zA-Z]/.test(letter)) {
      throw new PathParseError(position, `expected a command, found ${describeAt(d, position)}`);
    }
    if (previous === null && upper !== 'M') {
      throw new PathParseError(position, 'path data must start with a move command');
    }
    position += 1;
    previous = letter;
    let current = letter;
    let first = true;
    // One group of arguments, then more while a number follows (implicit repetition).
    for (;;) {
      if (count === 0) {
        commands.push({ letter: current, numbers: [] });
        skipWhitespace();
        break;
      }
      const numbers: NumberToken[] = [];
      for (let index = 0; index < count; index += 1) {
        if (index > 0 || !first) {
          skipSeparator();
        } else {
          skipWhitespace();
        }
        const isFlag = upper === 'A' && (index === 3 || index === 4);
        numbers.push(isFlag ? readFlag() : readNumber());
      }
      commands.push({ letter: current, numbers });
      first = false;
      const resume = position;
      skipSeparator();
      if (position < d.length && startsNumber()) {
        // A move command repeated is a line command (SVG path grammar).
        if (current === 'M') current = 'L';
        if (current === 'm') current = 'l';
        position = resume;
        continue;
      }
      position = resume;
      skipWhitespace();
      if (d.charAt(position) === ',') {
        throw new PathParseError(position, 'a comma must stand between two numbers');
      }
      break;
    }
  }
  if (commands.length === 0) {
    throw new PathParseError(0, 'path data is empty');
  }
  return commands;
}

function describeAt(d: string, position: number): string {
  return position >= d.length ? 'the end' : `"${d.charAt(position)}"`;
}

function arg(numbers: readonly NumberToken[], index: number): number {
  const token = numbers[index];
  if (token === undefined) {
    throw new PathParseError(0, 'missing argument');
  }
  return token.value;
}

function reflect(point: Point, about: Point): Point {
  return { x: 2 * about.x - point.x, y: 2 * about.y - point.y };
}

/** Reads path data into segments with absolute points. Throws `PathParseError` on any token it cannot read. */
export function parsePathData(d: string): readonly PathSegment[] {
  const segments: PathSegment[] = [];
  let point: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCubic: Point | null = null;
  let lastQuadratic: Point | null = null;

  for (const { letter, numbers } of tokenize(d)) {
    const upper = letter.toUpperCase();
    const isRelative = letter !== upper;
    const at = (xIndex: number, yIndex: number): Point => ({
      x: arg(numbers, xIndex) + (isRelative ? point.x : 0),
      y: arg(numbers, yIndex) + (isRelative ? point.y : 0),
    });
    let segment: PathSegment;
    switch (upper) {
      case 'M': {
        const to = at(0, 1);
        segment = { command: 'M', from: point, to, controls: [], arc: null };
        start = to;
        break;
      }
      case 'L':
        segment = { command: 'L', from: point, to: at(0, 1), controls: [], arc: null };
        break;
      case 'H': {
        const x = arg(numbers, 0) + (isRelative ? point.x : 0);
        segment = { command: 'H', from: point, to: { x, y: point.y }, controls: [], arc: null };
        break;
      }
      case 'V': {
        const y = arg(numbers, 0) + (isRelative ? point.y : 0);
        segment = { command: 'V', from: point, to: { x: point.x, y }, controls: [], arc: null };
        break;
      }
      case 'C':
        segment = {
          command: 'C',
          from: point,
          to: at(4, 5),
          controls: [at(0, 1), at(2, 3)],
          arc: null,
        };
        break;
      case 'S': {
        const first = lastCubic === null ? point : reflect(lastCubic, point);
        segment = {
          command: 'S',
          from: point,
          to: at(2, 3),
          controls: [first, at(0, 1)],
          arc: null,
        };
        break;
      }
      case 'Q':
        segment = { command: 'Q', from: point, to: at(2, 3), controls: [at(0, 1)], arc: null };
        break;
      case 'T': {
        const control = lastQuadratic === null ? point : reflect(lastQuadratic, point);
        segment = { command: 'T', from: point, to: at(0, 1), controls: [control], arc: null };
        break;
      }
      case 'A':
        segment = {
          command: 'A',
          from: point,
          to: at(5, 6),
          controls: [],
          arc: {
            rx: arg(numbers, 0),
            ry: arg(numbers, 1),
            rotation: arg(numbers, 2),
            largeArc: arg(numbers, 3) === 1 ? 1 : 0,
            sweep: arg(numbers, 4) === 1 ? 1 : 0,
          },
        };
        break;
      default:
        segment = { command: 'Z', from: point, to: start, controls: [], arc: null };
        break;
    }
    lastCubic =
      segment.command === 'C' || segment.command === 'S' ? (segment.controls[1] ?? null) : null;
    lastQuadratic =
      segment.command === 'Q' || segment.command === 'T' ? (segment.controls[0] ?? null) : null;
    segments.push(segment);
    point = segment.to;
  }
  return segments;
}

/** Every number of the path data as written, with arc flags marked. Throws `PathParseError`. */
export function pathNumbers(d: string): readonly { text: string; isArcFlag: boolean }[] {
  return tokenize(d).flatMap(({ numbers }) =>
    numbers.map(({ text, isArcFlag }) => ({ text, isArcFlag })),
  );
}

/**
 * The centre and radii of an arc from its end points, by the SVG 2 implementation notes' conversion,
 * with radii scaled up when they are too small to reach. Null when the arc is drawn as a line or not at all.
 */
function arcCentre(
  from: Point,
  to: Point,
  arc: ArcParameters,
): { centre: Point; radius: number } | null {
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    return null;
  }
  const phi = (arc.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const sign = arc.largeArc === arc.sweep ? -1 : 1;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = (coefficient * rx * y1) / ry;
  const cy1 = (-coefficient * ry * x1) / rx;
  return {
    centre: {
      x: cos * cx1 - sin * cy1 + (from.x + to.x) / 2,
      y: sin * cx1 + cos * cy1 + (from.y + to.y) / 2,
    },
    radius: Math.max(rx, ry),
  };
}

/**
 * The box of every end point and control point of the segments. An arc adds the box of its centre
 * plus and minus its larger radius on both axes, which holds the whole ellipse.
 */
export function pathExtent(segments: readonly PathSegment[]): PathBox {
  const box: PathBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const add = (x: number, y: number): void => {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  };
  for (const segment of segments) {
    add(segment.to.x, segment.to.y);
    for (const control of segment.controls) {
      add(control.x, control.y);
    }
    if (segment.arc !== null) {
      add(segment.from.x, segment.from.y);
      const circle = arcCentre(segment.from, segment.to, segment.arc);
      if (circle !== null) {
        add(circle.centre.x - circle.radius, circle.centre.y - circle.radius);
        add(circle.centre.x + circle.radius, circle.centre.y + circle.radius);
      }
    }
  }
  return box;
}
