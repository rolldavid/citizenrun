import type { Rule } from 'eslint';
import {
  child,
  children,
  field,
  keyOf,
  lastName,
  memberName,
  nameOf,
  numberValue,
  parentOf,
  report,
  stringValue,
  templateParts,
  text,
  unwrap,
} from '../ast.ts';
import type { AstNode, Listener } from '../ast.ts';
import { matchesAny, repoRelative, TEST_GLOBS } from '../paths.ts';

const INCLUDE = ['apps/mobile/app/**', 'apps/mobile/src/**', 'packages/cards/src/**'];
const CARDS = ['packages/cards/src/**'];
/** The token files, where visual values are defined, and the spike screens. */
const EXCLUDE = [
  'apps/mobile/src/ui/tokens.ts',
  'apps/mobile/src/ui/motion.ts',
  'apps/mobile/src/ui/typography.ts',
  'packages/cards/src/canvas.ts',
  'packages/shared/src/design/**',
  'apps/mobile/app/dev/spikes/**',
  'apps/mobile/src/platform/auth/provider-art.ts',
  ...TEST_GLOBS,
];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^\s*(?:rgba?|hsla?|hwb|oklch|oklab|color)\(/i;
const COLOR_KEY = /^(?:color|fill|stroke|stopColor|floodColor)$|Color$/;

/** The CSS named colors; `transparent` and `currentColor` are not among them and stay allowed. */
const CSS_COLOR_NAMES: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue ' +
    'darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
    'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise ' +
    'darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred ' +
    'indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta ' +
    'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple ' +
    'red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet ' +
    'wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const SIZE_EXACT: ReadonlySet<string> = new Set([
  'gap',
  'rowGap',
  'columnGap',
  'top',
  'right',
  'bottom',
  'left',
  'start',
  'end',
  'width',
  'height',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'opacity',
  'shadowRadius',
  'elevation',
]);
const SIZE_PATTERN =
  /^(?:margin|padding|inset)|^(?:min|max)[A-Z]|^border\w*Radius$|^border\w*Width$/;

const CANVAS_KEYS: ReadonlySet<string> = new Set(['fontSize', 'strokeWidth', 'rx', 'ry']);
const TIMING_KEYS: ReadonlySet<string> = new Set(['duration', 'delay']);
const SPRING_KEYS: ReadonlySet<string> = new Set(['damping', 'stiffness', 'mass']);
const TRANSITION_KEYS: ReadonlySet<string> = new Set([
  'transitionDuration',
  'transitionDelay',
  'animationDuration',
  'animationDelay',
]);
const TIME_STRING = /^\s*-?(?:\d+\.?\d*|\.\d+)\s*m?s\s*$/;
const EASING_MODULES: ReadonlySet<string> = new Set(['react-native-reanimated', 'react-native']);
/** Containers a style value may sit in between its property and the style call or attribute. */
const STYLE_PATH: ReadonlySet<string> = new Set([
  'ObjectExpression',
  'Property',
  'ArrayExpression',
  'ConditionalExpression',
  'LogicalExpression',
  'SpreadElement',
  'TSAsExpression',
  'TSSatisfiesExpression',
]);

function isSizeKey(key: string): boolean {
  return SIZE_EXACT.has(key) || SIZE_PATTERN.test(key);
}

/** True for a numeric literal other than 0, or its negation. */
function isNumberLiteral(expression: AstNode | null): boolean {
  const node = unwrap(expression);
  if (node === null) {
    return false;
  }
  if (node.type === 'UnaryExpression' && text(node, 'operator') === '-') {
    return isNumberLiteral(child(node, 'argument'));
  }
  const value = numberValue(node);
  return value !== null && value !== 0;
}

/** A numeric literal, or a conditional with one as a branch. */
function holdsNumberLiteral(expression: AstNode | null): boolean {
  const node = unwrap(expression);
  if (node?.type === 'ConditionalExpression') {
    return (
      holdsNumberLiteral(child(node, 'consequent')) || holdsNumberLiteral(child(node, 'alternate'))
    );
  }
  return isNumberLiteral(node);
}

function isStyleSheetCreate(node: AstNode): boolean {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = child(node, 'callee');
  return (
    callee?.type === 'MemberExpression' &&
    memberName(callee) === 'create' &&
    lastName(child(callee, 'object')) === 'StyleSheet'
  );
}

/** True when a property sits inside a `StyleSheet.create` argument or a JSX style attribute. */
function inStyle(property: AstNode): boolean {
  let current: AstNode = property;
  let parent = parentOf(current);
  while (parent !== null && STYLE_PATH.has(parent.type)) {
    current = parent;
    parent = parentOf(current);
  }
  if (parent === null) {
    return false;
  }
  if (isStyleSheetCreate(parent)) {
    return children(parent, 'arguments').includes(current);
  }
  if (parent.type === 'JSXExpressionContainer') {
    const attribute = parentOf(parent);
    const key = attribute?.type === 'JSXAttribute' ? keyOf(attribute) : null;
    return key !== null && (key === 'style' || key.endsWith('Style'));
  }
  return false;
}

function isColorString(value: string): boolean {
  return HEX_COLOR.test(value) || COLOR_FUNCTION.test(value);
}

/** The value of a JSX attribute: its literal, or the expression in its container. */
function attributeValue(node: AstNode): AstNode | null {
  const value = child(node, 'value');
  return value?.type === 'JSXExpressionContainer' ? child(value, 'expression') : value;
}

function optionsArgument(call: AstNode, index: number): AstNode[] {
  const options = unwrap(children(call, 'arguments')[index] ?? null);
  return options?.type === 'ObjectExpression' ? children(options, 'properties') : [];
}

/** Colors, sizes, canvas sizes and motion values come from tokens (D-293). */
export const tokensOnly: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Visual values come from the design tokens.' },
    schema: [],
    messages: {
      color: 'Colors come from the active theme and the tokens; do not write a color literal.',
      size: 'Sizes come from the tokens; do not write a bare number for {{name}}.',
      canvas: 'Canvas sizes come from the canvas tokens; do not write a bare number for {{name}}.',
      motion: 'Motion uses the presets in the motion module; do not write a bare {{name}}.',
      easing: 'Motion uses the presets in the motion module; do not import Easing.',
    },
  },
  create(context) {
    const rel = repoRelative(context.filename);
    if (!matchesAny(rel, INCLUDE) || matchesAny(rel, EXCLUDE)) {
      return {};
    }
    const isCards = matchesAny(rel, CARDS);

    const checkKeyed = (node: AstNode, key: string, value: AstNode | null): void => {
      if (COLOR_KEY.test(key)) {
        const color = stringValue(unwrap(value));
        if (color !== null && CSS_COLOR_NAMES.has(color.trim().toLowerCase())) {
          report(context, node, 'color');
        }
      }
      if (TRANSITION_KEYS.has(key)) {
        const inner = unwrap(value);
        const time = stringValue(inner);
        if (isNumberLiteral(inner) || (time !== null && TIME_STRING.test(time))) {
          report(context, node, 'motion', { name: key });
        }
      }
    };

    const listener: Listener = {
      Literal(node: AstNode) {
        const value = field(node, 'value');
        if (typeof value === 'string' && isColorString(value)) {
          report(context, node, 'color');
        }
      },
      TemplateLiteral(node: AstNode) {
        const first = templateParts(node)[0];
        if (first !== undefined && isColorString(first)) {
          report(context, node, 'color');
        }
      },
      Property(node: AstNode) {
        const key = keyOf(node);
        if (key === null || parentOf(node)?.type !== 'ObjectExpression') {
          return;
        }
        const value = child(node, 'value');
        checkKeyed(node, key, value);
        if (isSizeKey(key) && holdsNumberLiteral(value) && inStyle(node)) {
          report(context, node, 'size', { name: key });
        }
      },
      JSXAttribute(node: AstNode) {
        const key = keyOf(node);
        if (key === null) {
          return;
        }
        const value = attributeValue(node);
        checkKeyed(node, key, value);
        if (isCards && CANVAS_KEYS.has(key) && isNumberLiteral(value)) {
          report(context, node, 'canvas', { name: key });
        }
      },
      CallExpression(node: AstNode) {
        const callee = child(node, 'callee');
        const name = lastName(callee);
        const isAnimatedTiming =
          callee?.type === 'MemberExpression' &&
          name === 'timing' &&
          lastName(child(callee, 'object')) === 'Animated';
        if (name === 'withTiming' || isAnimatedTiming) {
          for (const property of optionsArgument(node, 1)) {
            const key = keyOf(property);
            if (key !== null && TIMING_KEYS.has(key) && isNumberLiteral(child(property, 'value'))) {
              report(context, property, 'motion', { name: key });
            }
          }
        } else if (name === 'withSpring') {
          for (const property of optionsArgument(node, 1)) {
            const key = keyOf(property);
            if (key !== null && SPRING_KEYS.has(key) && isNumberLiteral(child(property, 'value'))) {
              report(context, property, 'motion', { name: key });
            }
          }
        } else if (
          name === 'withDelay' &&
          isNumberLiteral(children(node, 'arguments')[0] ?? null)
        ) {
          report(context, node, 'motion', { name: 'delay' });
        }
      },
      ImportDeclaration(node: AstNode) {
        const source = stringValue(child(node, 'source'));
        if (source === null || !EASING_MODULES.has(source)) {
          return;
        }
        for (const specifier of children(node, 'specifiers')) {
          if (specifier.type !== 'ImportSpecifier') {
            continue;
          }
          const imported = child(specifier, 'imported');
          if ((nameOf(imported) ?? stringValue(imported)) === 'Easing') {
            report(context, specifier, 'easing');
          }
        }
      },
    };
    return listener;
  },
};
