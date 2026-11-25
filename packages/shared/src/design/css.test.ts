import { describe, expect, it } from 'vitest';

import { DOCUMENT_PAGE_CSS, EMAIL_STYLES, FONT_FACE_CSS, SHELL_CSS, tokensCss } from './css.ts';
import { color, fixed, radius } from './tokens.ts';
import type { ThemeName } from './tokens.ts';
import { FONT_STACKS } from './type.ts';

const FONT_FACE_LINES = [
  '@font-face{font-family:"Special Gothic";src:url(/fonts/2/SpecialGothic-Regular.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Special Gothic";src:url(/fonts/2/SpecialGothic-Medium.woff2) format("woff2");font-weight:500;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Special Gothic";src:url(/fonts/2/SpecialGothic-Bold.woff2) format("woff2");font-weight:700;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Chivo Mono";src:url(/fonts/2/ChivoMono-Medium.woff2) format("woff2");font-weight:500;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Special Gothic Fallback";src:local("Arial");font-weight:400;size-adjust:94.5%;ascent-override:106.3%;descent-override:31.2%}',
  '@font-face{font-family:"Special Gothic Fallback";src:local("Arial");font-weight:500;size-adjust:97.7%;ascent-override:102.9%;descent-override:30.2%}',
  '@font-face{font-family:"Special Gothic Fallback";src:local("Arial Bold"),local("Arial");font-weight:700;size-adjust:100.8%;ascent-override:99.7%;descent-override:29.3%}',
  '@font-face{font-family:"SpecialGothic-Regular";src:url(/fonts/2/SpecialGothic-Regular.woff2) format("woff2"),local("Helvetica Neue"),local("Arial");font-display:block}',
  '@font-face{font-family:"SpecialGothic-Medium";src:url(/fonts/2/SpecialGothic-Medium.woff2) format("woff2"),local("Helvetica Neue Medium"),local("Arial");font-display:block}',
  '@font-face{font-family:"SpecialGothic-Bold";src:url(/fonts/2/SpecialGothic-Bold.woff2) format("woff2"),local("Helvetica Neue Bold"),local("Arial Bold"),local("Arial");font-display:block}',
  '@font-face{font-family:"ChivoMono-Medium";src:url(/fonts/2/ChivoMono-Medium.woff2) format("woff2"),local("Menlo"),local("Consolas"),local("Courier New");font-display:block}',
];

const TOKENS_CSS_LINES = [
  ':root{color-scheme:light;--bg:#F1EFE7;--surface:#FDFCF9;--well:#E3E0D5;--text:#141412;--text-secondary:#535148;--rule:#141412;--rule-soft:#D5D2C7;--accent:#F04E14;--on-accent:#141412;--highlight:#D9F23E;--on-highlight:#141412;--success:#17683A;--danger:#B3202A;--inverse-bg:#141412;--inverse-text:#F3F1EA;--inverse-hover:#2A2A26;--focus-ring:#141412;--font-sans:"Special Gothic","Special Gothic Fallback","Helvetica Neue",Arial,sans-serif;--font-mono:"Chivo Mono",ui-monospace,Menlo,Consolas,monospace;--radius-tag:2px;--radius-control:4px}',
  '@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#121210;--surface:#1F1F1C;--well:#2A2A26;--text:#F3F1EA;--text-secondary:#A9A69B;--rule:#A9A69B;--rule-soft:#33332E;--accent:#F04E14;--on-accent:#141412;--highlight:#D9F23E;--on-highlight:#141412;--success:#6FD08C;--danger:#FD8692;--inverse-bg:#F3F1EA;--inverse-text:#141412;--inverse-hover:#E3E0D5;--focus-ring:#F3F1EA}}',
];

const DOCUMENT_PAGE_RULE_LINES = [
  '*,*::before,*::after{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--text);font:400 16px/22px var(--font-sans)}',
  'header,main,footer{max-width:688px;margin:0 auto;padding:0 16px}',
  '@media (min-width:380px){header,main,footer{padding:0 24px}}',
  'header{display:flex;align-items:center;min-height:48px;border-bottom:1px solid var(--rule)}',
  'header a{font:500 16px/22px var(--font-sans);color:var(--text);text-decoration:none}',
  'main{padding-top:32px;padding-bottom:48px}',
  'h1{font:500 28px/32px var(--font-sans);letter-spacing:-0.015em;margin:0 0 24px}',
  'h2{font:500 20px/26px var(--font-sans);letter-spacing:-0.01em;margin:32px 0 12px}',
  'h3{font:500 16px/22px var(--font-sans);margin:24px 0 8px}',
  'p{margin:0 0 12px}',
  'ul,ol{margin:0 0 12px;padding-left:24px}',
  'ul{list-style:none}',
  'ul>li{position:relative}',
  'ul>li::before{content:"";position:absolute;left:-16px;top:9px;width:4px;height:4px;background:var(--text)}',
  'li{margin:0 0 4px}',
  'strong{font-weight:500}',
  'a{color:var(--text);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:0.18em}',
  'a:hover,a:focus-visible{text-decoration-thickness:2px}',
  ':focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}',
  'footer{padding-top:16px;padding-bottom:32px;border-top:1px solid var(--rule);display:flex;flex-wrap:wrap;gap:8px 24px;font:400 13px/18px var(--font-sans);color:var(--text-secondary)}',
  'footer a{color:var(--text-secondary);min-height:44px;display:inline-flex;align-items:center}',
  'form{display:grid;gap:16px;margin:24px 0}',
  'label{display:grid;gap:8px;font:500 14px/18px var(--font-sans)}',
  'input,textarea,select{width:100%;min-height:48px;padding:12px 16px;border:1px solid var(--rule);border-radius:var(--radius-control);background:var(--surface);color:var(--text);font:400 16px/22px var(--font-sans)}',
  'textarea{min-height:144px;resize:vertical}',
  'input[type=checkbox],input[type=radio]{width:20px;min-height:20px;height:20px;padding:0;accent-color:var(--inverse-bg)}',
  'label:has(input[type=checkbox]),label:has(input[type=radio]){grid-template-columns:20px 1fr;align-items:center;min-height:44px;font:400 16px/22px var(--font-sans)}',
  'button{min-height:44px;padding:8px 16px;border:1px solid var(--inverse-bg);border-radius:var(--radius-control);background:var(--inverse-bg);color:var(--inverse-text);font:500 16px/22px var(--font-sans);cursor:pointer;justify-self:start}',
  'button:hover{background:var(--inverse-hover);border-color:var(--inverse-hover)}',
  'button:active{transform:translateY(1px) scale(0.98)}',
  '[aria-invalid=true]{border:2px solid var(--danger)}',
  '[role=alert]{color:var(--danger);font:400 13px/18px var(--font-sans)}',
  '[role=status]{background:var(--well);border-radius:var(--radius-control);padding:12px}',
  'input[name=website],label:has(input[name=website]){display:none}',
  '[hidden]{display:none}',
];

/** What the document page stylesheet opens with: the font faces, then the custom properties. */
const DOCUMENT_PAGE_HEAD = `${FONT_FACE_CSS}\n${tokensCss()}\n`;

/** The document page stylesheet after its font faces and custom properties. */
function documentPageRules(): string {
  return DOCUMENT_PAGE_CSS.slice(DOCUMENT_PAGE_HEAD.length);
}

/** The value of one declaration of a `selector{name:value;...}` rule, or undefined when it has none. */
function declarationValue(ruleText: string, name: string): string | undefined {
  const body = /\{(.*)\}$/.exec(ruleText)?.[1] ?? '';
  const declaration = body.split(';').find((part) => part.startsWith(`${name}:`));
  return declaration?.slice(name.length + 1);
}

/** The `--name:value` declarations of one `:root{...}` block. */
function declarations(block: string): Map<string, string> {
  const body = /:root\{([^}]*)\}/.exec(block)?.[1];
  if (body === undefined) {
    throw new Error(`no :root block in ${block}`);
  }
  const out = new Map<string, string>();
  for (const part of body.split(';')) {
    const match = /^--([a-z-]+):(.*)$/.exec(part);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out.set(match[1], match[2]);
    }
  }
  return out;
}

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Declarations of `color-scheme`, not the media feature `prefers-color-scheme` that contains the same text. */
function declarationsOf(text: string, declaration: string): number {
  return text
    .split(declaration)
    .filter((_, index, parts) => index > 0 && !(parts[index - 1] ?? '').endsWith('-')).length;
}

const FONT_PROPERTIES = new Set(['font-sans', 'font-mono', 'radius-tag', 'radius-control']);

describe('server CSS from tokens', () => {
  it('FONT_FACE_CSS is the eleven rules', () => {
    expect(FONT_FACE_CSS.split('\n')).toEqual(FONT_FACE_LINES);
  });

  it('SHELL_CSS is the fonts, the ground and the focus rule', () => {
    expect(SHELL_CSS.startsWith(FONT_FACE_CSS)).toBe(true);
    expect(SHELL_CSS.slice(FONT_FACE_CSS.length).trim().split('\n')).toEqual([
      'html,body{background-color:#F1EFE7}',
      '@media (prefers-color-scheme:dark){html,body{background-color:#121210}}',
      ':focus:not(:focus-visible){outline:none!important}',
    ]);
  });

  it("the shell's ground is each theme's bg token", () => {
    expect(SHELL_CSS).toContain(`html,body{background-color:${color.light.bg}}`);
    expect(SHELL_CSS).toContain(
      `@media (prefers-color-scheme:dark){html,body{background-color:${color.dark.bg}}}`,
    );
  });

  it('tokensCss matches its published output', () => {
    expect(tokensCss()).toBe(TOKENS_CSS_LINES.join('\n'));
  });

  it('tokensCss round-trips the tokens', () => {
    const [lightLine, darkLine] = tokensCss().split('\n');
    const blocks: [ThemeName, string | undefined][] = [
      ['light', lightLine],
      ['dark', darkLine],
    ];
    for (const [theme, line] of blocks) {
      const parsed = declarations(line ?? '');
      const colorNames = [...parsed.keys()].filter((name) => !FONT_PROPERTIES.has(name));
      expect(colorNames.length).toBe(17);
      for (const name of colorNames) {
        const key = camelCase(name);
        expect(Object.hasOwn(color[theme], key), `${theme} --${name}`).toBe(true);
        expect(parsed.get(name), `${theme} --${name}`).toBe(
          color[theme][key as keyof (typeof color)[ThemeName]], // checked by hasOwn just above
        );
      }
    }
    const light = declarations(lightLine ?? '');
    // The CSS stack is the token's stack with the spaces after its commas removed.
    expect(light.get('font-sans')?.split(',')).toEqual(FONT_STACKS.sans.split(', '));
    expect(light.get('font-mono')?.split(',')).toEqual(FONT_STACKS.mono.split(', '));
    expect(light.get('radius-control')).toBe(`${String(radius.control)}px`);
    expect(light.get('radius-tag')).toBe(`${String(radius.tag)}px`);
  });

  it('both themes are present', () => {
    for (const css of [tokensCss(), DOCUMENT_PAGE_CSS]) {
      expect(declarationsOf(css, 'color-scheme:light')).toBe(1);
      expect(declarationsOf(css, 'color-scheme:dark')).toBe(1);
      expect(count(css, '@media (prefers-color-scheme:dark)')).toBe(1);
    }
    expect(DOCUMENT_PAGE_CSS).toContain(':root{color-scheme:light;');
    expect(DOCUMENT_PAGE_CSS).toContain('@media (prefers-color-scheme:dark)');
  });

  it('every hex color is a token value', () => {
    const tokenValues = new Set([
      ...Object.values(color.light),
      ...Object.values(color.dark),
      ...Object.values(fixed),
    ]);
    const sources = [tokensCss(), DOCUMENT_PAGE_CSS, ...Object.values(EMAIL_STYLES)];
    let seen = 0;
    for (const source of sources) {
      for (const match of source.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
        seen += 1;
        expect(tokenValues.has(match[0]), match[0]).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('document page stylesheet starts with the fonts and the tokens', () => {
    expect(DOCUMENT_PAGE_CSS.startsWith(DOCUMENT_PAGE_HEAD)).toBe(true);
    const headLines = [...FONT_FACE_LINES, ...TOKENS_CSS_LINES];
    expect(DOCUMENT_PAGE_CSS.split('\n').slice(0, headLines.length)).toEqual(headLines);
  });

  it('document page rules equal the contract text', () => {
    expect(DOCUMENT_PAGE_RULE_LINES.length).toBe(37);
    expect(DOCUMENT_PAGE_CSS.startsWith(DOCUMENT_PAGE_HEAD)).toBe(true);
    expect(documentPageRules().split('\n')).toEqual(DOCUMENT_PAGE_RULE_LINES);
    expect(documentPageRules()).toBe(DOCUMENT_PAGE_RULE_LINES.join('\n'));
  });

  it('document page stylesheet has no stray hex color', () => {
    const themeValues = new Set([...Object.values(color.light), ...Object.values(color.dark)]);
    const found = [...DOCUMENT_PAGE_CSS.matchAll(/#[0-9A-Za-z]+/g)].map((match) => match[0]);
    expect(found.length).toBeGreaterThan(0);
    for (const value of found) {
      expect(themeValues.has(value), value).toBe(true);
    }
    // The rules name colors only through the custom properties.
    expect(documentPageRules()).not.toMatch(/#|rgba?\(|hsla?\(/);
  });

  it('document page rules use only declared custom properties', () => {
    const [lightLine, darkLine] = tokensCss().split('\n');
    const light = declarations(lightLine ?? '');
    const dark = declarations(darkLine ?? '');
    const used = new Set(
      [...documentPageRules().matchAll(/var\(--([a-z-]+)\)/g)].map((match) => match[1] ?? ''),
    );
    expect(used.size).toBeGreaterThan(0);
    expect(count(documentPageRules(), 'var(')).toBe(count(documentPageRules(), 'var(--'));
    for (const name of used) {
      expect(light.has(name), `--${name}`).toBe(true);
      if (!FONT_PROPERTIES.has(name)) {
        expect(dark.has(name), `dark --${name}`).toBe(true);
      }
    }
  });

  it('the submit button is ink', () => {
    const button = DOCUMENT_PAGE_CSS.split('\n').find((line) => line.startsWith('button{'));
    expect(button).toBeDefined();
    expect(declarationValue(button ?? '', 'background')).toBe('var(--inverse-bg)');
    expect(DOCUMENT_PAGE_CSS).not.toContain('var(--accent)');
  });

  it("EMAIL_STYLES has the layout's members", () => {
    expect(Object.keys(EMAIL_STYLES).sort()).toEqual(
      [
        'body',
        'button',
        'code',
        'container',
        'footer',
        'heading',
        'link',
        'paragraph',
        'rule',
      ].sort(),
    );
    expect(EMAIL_STYLES.body).toContain(fixed.emailBg);
    expect(EMAIL_STYLES.body).toContain(fixed.ink);
  });
});
