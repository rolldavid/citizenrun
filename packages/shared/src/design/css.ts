// Plain CSS for the web shell, for the pages the server writes and for email (DS-css). Every color,
// size and family is read from the token modules, so these strings cannot drift from the app.
// Lint rule citizenrun/tokens-only is off in this file; it still states no color of its own.
import { color, fixed, radius } from './tokens.ts';
import type { ColorToken, ThemeName } from './tokens.ts';
import { FONT_CSS, FONT_FALLBACK_METRICS, FONT_FILES, FONT_STACKS, FONT_URL_BASE } from './type.ts';
import type { FontFace } from './type.ts';

type FallbackFace = keyof typeof FONT_FALLBACK_METRICS;

const FACES = ['regular', 'medium', 'bold', 'mono'] as const satisfies readonly FontFace[];
const FALLBACK_FACES = ['regular', 'medium', 'bold'] as const satisfies readonly FallbackFace[];

/** The family of the metric-matched fallback: the second name in the sans stack. */
const FALLBACK_FAMILY = `${FONT_CSS.regular.family} Fallback`;

/** The local faces the metric overrides are measured against; bold asks for the bold cut first. */
const FALLBACK_LOCALS: Readonly<Record<FallbackFace, readonly string[]>> = {
  regular: ['Arial'],
  medium: ['Arial'],
  bold: ['Arial Bold', 'Arial'],
};

/** What a per-file family falls to when its file fails to load, so text never drops to a serif. */
const FILE_LOCALS: Readonly<Record<FontFace, readonly string[]>> = {
  regular: ['Helvetica Neue', 'Arial'],
  medium: ['Helvetica Neue Medium', 'Arial'],
  bold: ['Helvetica Neue Bold', 'Arial Bold', 'Arial'],
  mono: ['Menlo', 'Consolas', 'Courier New'],
};

function fileSource(face: FontFace): string {
  return `url(${FONT_URL_BASE}/${FONT_FILES[face]}.woff2) format("woff2")`;
}

function localSources(names: readonly string[]): string {
  return names.map((name) => `local("${name}")`).join(',');
}

/** A face under its family name and weight, swapped in behind the fallback: server CSS and SVG. */
function familyRule(face: FontFace): string {
  const { family, weight } = FONT_CSS[face];
  return `@font-face{font-family:"${family}";src:${fileSource(face)};font-weight:${String(weight)};font-style:normal;font-display:swap}`;
}

/** Local Arial with metric overrides, so the swap to the real face does not move the layout. */
function fallbackRule(face: FallbackFace): string {
  const { sizeAdjust, ascentOverride, descentOverride } = FONT_FALLBACK_METRICS[face];
  return `@font-face{font-family:"${FALLBACK_FAMILY}";src:${localSources(FALLBACK_LOCALS[face])};font-weight:${String(FONT_CSS[face].weight)};size-adjust:${String(sizeAdjust)}%;ascent-override:${String(ascentOverride)}%;descent-override:${String(descentOverride)}%}`;
}

/** A face under its file name, the one family string the app's own styles carry. */
function fileRule(face: FontFace): string {
  return `@font-face{font-family:"${FONT_FILES[face]}";src:${fileSource(face)},${localSources(FILE_LOCALS[face])};font-display:block}`;
}

/**
 * The eleven @font-face rules of the web, one per line: the four faces by family and weight, the
 * three metric-matched fallbacks, and the four faces by file name. Both sets of names point at the
 * same four files.
 */
export const FONT_FACE_CSS = [
  ...FACES.map(familyRule),
  ...FALLBACK_FACES.map(fallbackRule),
  ...FACES.map(fileRule),
].join('\n');

/**
 * The whole text of the web shell's style element: the font faces, then the one rule that hides
 * the focus ring from a pointer and leaves it for the keyboard.
 */
export const SHELL_CSS =
  FONT_FACE_CSS + '\n' + ':focus:not(:focus-visible){outline:none!important}';

/** The color tokens a server page uses, in the order its custom properties are written. */
const CSS_COLOR_TOKENS = [
  'bg',
  'surface',
  'well',
  'text',
  'textSecondary',
  'rule',
  'ruleSoft',
  'accent',
  'onAccent',
  'highlight',
  'onHighlight',
  'success',
  'danger',
  'inverseBg',
  'inverseText',
  'inverseHover',
  'focusRing',
] as const satisfies readonly ColorToken[];

/** A camelCase token name as a kebab-case custom property name, without the two dashes. */
function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function colorProperties(theme: ThemeName): string {
  return CSS_COLOR_TOKENS.map((token) => `--${kebabCase(token)}:${color[theme][token]}`).join(';');
}

/** A font stack with no space after its commas. */
function compactStack(stack: string): string {
  return stack.split(', ').join(',');
}

/**
 * The custom properties of a page the server writes, as two lines: the light values with the two
 * font stacks and the two radii, then the dark values for a system in its dark theme. Such a page
 * follows the system theme and carries no map or issue value.
 */
export function tokensCss(): string {
  const light = [
    'color-scheme:light',
    colorProperties('light'),
    `--font-sans:${compactStack(FONT_STACKS.sans)}`,
    `--font-mono:${compactStack(FONT_STACKS.mono)}`,
    `--radius-tag:${String(radius.tag)}px`,
    `--radius-control:${String(radius.control)}px`,
  ].join(';');
  const dark = ['color-scheme:dark', colorProperties('dark')].join(';');
  return [`:root{${light}}`, `@media (prefers-color-scheme:dark){:root{${dark}}}`].join('\n');
}

const EMAIL_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const EMAIL_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * The inline style values of the one email layout. Email clients load no web font and no
 * stylesheet, so each value is a complete declaration list: ink on white, no image and no accent.
 */
export const EMAIL_STYLES = {
  body: `margin:0;padding:0;background:${fixed.emailBg};color:${fixed.ink};font-family:${EMAIL_SANS};font-size:16px;line-height:24px`,
  container: 'max-width:480px;margin:0 auto;padding:32px 16px',
  heading: 'margin:0 0 16px;font-size:20px;line-height:28px;font-weight:500',
  paragraph: 'margin:0 0 16px',
  code: `margin:0 0 16px;font-family:${EMAIL_MONO};font-size:28px;line-height:36px;font-weight:700;letter-spacing:2px`,
  button: `display:inline-block;padding:12px 20px;background:${fixed.ink};color:${fixed.bone};text-decoration:none;font-weight:500;border-radius:${String(radius.control)}px`,
  link: `color:${fixed.ink};text-decoration:underline`,
  rule: `border:0;border-top:1px solid ${color.light.rule};margin:24px 0`,
  footer: `margin:0;font-size:13px;line-height:20px;color:${color.light.textSecondary}`,
} as const;
