// Plain CSS for the web shell, for the pages the server writes and for email (DS-css). Every color,
// size and family is read from the token modules, so these strings cannot drift from the app.
// Lint rule citizenrun/tokens-only is off in this file; it still states no color of its own.
import { motion } from './motion.ts';
import { color, fixed, gutter, radius, rule, size, space } from './tokens.ts';
import type { ColorToken, ThemeName } from './tokens.ts';
import {
  FONT_CSS,
  FONT_FALLBACK_METRICS,
  FONT_FILES,
  FONT_STACKS,
  FONT_URL_BASE,
  typeRoles,
} from './type.ts';
import type { FontFace, TypeRole } from './type.ts';

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
 * The page's ground before the app's first paint, one line per system color scheme: the theme the
 * person chose is known only once JavaScript runs, so the shell follows the system until then.
 */
const SHELL_GROUND_CSS = [
  `html,body{background-color:${color.light.bg}}`,
  `@media (prefers-color-scheme:dark){html,body{background-color:${color.dark.bg}}}`,
].join('\n');

/**
 * The whole text of the web shell's style element: the font faces, the ground, then the one rule
 * that hides the focus ring from a pointer and leaves it for the keyboard.
 */
export const SHELL_CSS =
  FONT_FACE_CSS +
  '\n' +
  SHELL_GROUND_CSS +
  '\n' +
  ':focus:not(:focus-visible){outline:none!important}';

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

const px = (n: number): string => `${String(n)}px`;

/** `font` shorthand for a type role: weight, size/line height, and the sans or mono stack's custom property. */
function cssFont(role: TypeRole): string {
  const r = typeRoles[role];
  return `${String(FONT_CSS[r.face].weight)} ${px(r.size)}/${px(r.lineHeight)} var(--font-${r.face === 'mono' ? 'mono' : 'sans'})`;
}

/** How far a link's underline sits under the baseline: the one size here that no token holds. */
const LINK_UNDERLINE_OFFSET = '0.18em';

/**
 * The rules of a document page, one per line: a single column on the page's ground, its header
 * and footer, long-form text, and the fields and the one button of a public form.
 */
function documentPageRules(): string[] {
  const body = cssFont('body');
  const strong = cssFont('bodyStrong');
  const caption = cssFont('caption');
  const hairline = px(rule.hairline);
  const checkbox = px(size.checkbox);
  const marker = px(size.listMarker);
  return [
    '*,*::before,*::after{box-sizing:border-box}',
    'html{-webkit-text-size-adjust:100%}',
    `body{margin:0;background:var(--bg);color:var(--text);font:${body};overflow-wrap:anywhere}`,
    `header,main,footer{max-width:${px(size.longForm + 2 * gutter.regular)};margin:0 auto;padding:0 ${px(gutter.narrow)}}`,
    `@media (min-width:${px(gutter.narrowBelow)}){header,main,footer{padding:0 ${px(gutter.regular)}}}`,
    `header{display:flex;align-items:center;min-height:${px(size.appBar)};border-bottom:${hairline} solid var(--rule)}`,
    `header a{font:${strong};color:var(--text);text-decoration:none;min-height:${px(size.target)};display:inline-flex;align-items:center}`,
    'header a:hover,header a:focus-visible{text-decoration-line:underline}',
    `main{padding-top:${px(space.x8)};padding-bottom:${px(space.x12)}}`,
    `h1{font:${cssFont('title')};letter-spacing:${String(typeRoles.title.tracking)}em;margin:0 0 ${px(space.x6)}}`,
    `h2{font:${cssFont('heading')};letter-spacing:${String(typeRoles.heading.tracking)}em;margin:${px(space.x8)} 0 ${px(space.x3)}}`,
    `h3{font:${strong};margin:${px(space.x6)} 0 ${px(space.x2)}}`,
    `p{margin:0 0 ${px(space.x3)}}`,
    `ul,ol{margin:0 0 ${px(space.x3)};padding-left:${px(space.x6)}}`,
    'ul{list-style:none}',
    'ul>li{position:relative}',
    `ul>li::before{content:"";position:absolute;left:${px(-space.x4)};top:${px((typeRoles.body.lineHeight - size.listMarker) / 2)};width:${marker};height:${marker};background:var(--text)}`,
    `li{margin:0 0 ${px(space.x1)}}`,
    `strong{font-weight:${String(FONT_CSS.medium.weight)}}`,
    `a{color:var(--text);text-decoration:underline;text-decoration-thickness:${px(rule.underline)};text-underline-offset:${LINK_UNDERLINE_OFFSET}}`,
    `a:hover,a:focus-visible{text-decoration-thickness:${px(rule.underlineHover)}}`,
    `:focus-visible{outline:${px(rule.focus)} solid var(--focus-ring);outline-offset:${px(rule.focusGap)}}`,
    `footer{padding-top:${px(space.x4)};padding-bottom:${px(space.x8)};border-top:${hairline} solid var(--rule);display:flex;flex-wrap:wrap;gap:${px(space.x2)} ${px(space.x6)};font:${caption};color:var(--text-secondary)}`,
    `footer a{color:var(--text-secondary);min-height:${px(size.target)};display:inline-flex;align-items:center}`,
    `form{display:grid;gap:${px(space.x4)};margin:${px(space.x6)} 0}`,
    `label{display:grid;gap:${px(space.x2)};font:${cssFont('label')}}`,
    `input,textarea,select{width:100%;min-height:${px(size.input)};padding:${px(space.x3)} ${px(space.x4)};border:${hairline} solid var(--rule);border-radius:var(--radius-control);background:var(--surface);color:var(--text);font:${body}}`,
    `textarea{min-height:${px(size.input * 3)};resize:vertical}`,
    `input[type=checkbox],input[type=radio]{width:${checkbox};min-height:${checkbox};height:${checkbox};padding:0;accent-color:var(--inverse-bg)}`,
    `label:has(input[type=checkbox]),label:has(input[type=radio]){grid-template-columns:${checkbox} 1fr;align-items:center;min-height:${px(size.target)};font:${body}}`,
    `button{min-height:${px(size.button)};padding:${px(space.x2)} ${px(space.x4)};border:${hairline} solid var(--inverse-bg);border-radius:var(--radius-control);background:var(--inverse-bg);color:var(--inverse-text);font:${strong};cursor:pointer;justify-self:start}`,
    'button:hover{background:var(--inverse-hover);border-color:var(--inverse-hover)}',
    `button:active{transform:translateY(${px(motion.distance.press)}) scale(${String(motion.scale.press)})}`,
    `[aria-invalid=true]{border:${px(rule.fieldState)} solid var(--danger)}`,
    `[role=alert]{color:var(--danger);font:${caption}}`,
    `[role=status]{background:var(--well);border-radius:var(--radius-control);padding:${px(space.x3)}}`,
    'input[name=website],label:has(input[name=website]){display:none}',
    '[hidden]{display:none}',
  ];
}

/** The stylesheet of the legal and public information pages the API writes (DS-css). */
export const DOCUMENT_PAGE_CSS: string =
  FONT_FACE_CSS + '\n' + tokensCss() + '\n' + documentPageRules().join('\n');

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
