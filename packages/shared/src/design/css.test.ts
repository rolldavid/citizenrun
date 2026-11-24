import { describe, expect, it } from 'vitest';

import { EMAIL_STYLES, FONT_FACE_CSS, SHELL_CSS, tokensCss } from './css.ts';
import { color, fixed, radius } from './tokens.ts';
import type { ThemeName } from './tokens.ts';
import { FONT_STACKS } from './type.ts';

const FONT_FACE_LINES = [
  '@font-face{font-family:"Special Gothic";src:url(/fonts/1/SpecialGothic-Regular.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Special Gothic";src:url(/fonts/1/SpecialGothic-Medium.woff2) format("woff2");font-weight:500;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Special Gothic";src:url(/fonts/1/SpecialGothic-Bold.woff2) format("woff2");font-weight:700;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Chivo Mono";src:url(/fonts/1/ChivoMono-Medium.woff2) format("woff2");font-weight:500;font-style:normal;font-display:swap}',
  '@font-face{font-family:"Special Gothic Fallback";src:local("Arial");font-weight:400;size-adjust:94.5%;ascent-override:106.3%;descent-override:31.2%}',
  '@font-face{font-family:"Special Gothic Fallback";src:local("Arial");font-weight:500;size-adjust:97.7%;ascent-override:102.9%;descent-override:30.2%}',
  '@font-face{font-family:"Special Gothic Fallback";src:local("Arial Bold"),local("Arial");font-weight:700;size-adjust:100.8%;ascent-override:99.7%;descent-override:29.3%}',
  '@font-face{font-family:"SpecialGothic-Regular";src:url(/fonts/1/SpecialGothic-Regular.woff2) format("woff2"),local("Helvetica Neue"),local("Arial");font-display:block}',
  '@font-face{font-family:"SpecialGothic-Medium";src:url(/fonts/1/SpecialGothic-Medium.woff2) format("woff2"),local("Helvetica Neue Medium"),local("Arial");font-display:block}',
  '@font-face{font-family:"SpecialGothic-Bold";src:url(/fonts/1/SpecialGothic-Bold.woff2) format("woff2"),local("Helvetica Neue Bold"),local("Arial Bold"),local("Arial");font-display:block}',
  '@font-face{font-family:"ChivoMono-Medium";src:url(/fonts/1/ChivoMono-Medium.woff2) format("woff2"),local("Menlo"),local("Consolas"),local("Courier New");font-display:block}',
];

const TOKENS_CSS_LINES = [
  ':root{color-scheme:light;--bg:#F1EFE7;--surface:#FDFCF9;--well:#E3E0D5;--text:#141412;--text-secondary:#535148;--rule:#141412;--rule-soft:#D5D2C7;--accent:#F04E14;--on-accent:#141412;--highlight:#D9F23E;--on-highlight:#141412;--success:#17683A;--danger:#B3202A;--inverse-bg:#141412;--inverse-text:#F3F1EA;--inverse-hover:#2A2A26;--focus-ring:#141412;--font-sans:"Special Gothic","Special Gothic Fallback","Helvetica Neue",Arial,sans-serif;--font-mono:"Chivo Mono",ui-monospace,Menlo,Consolas,monospace;--radius-tag:2px;--radius-control:4px}',
  '@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#121210;--surface:#1F1F1C;--well:#2A2A26;--text:#F3F1EA;--text-secondary:#A9A69B;--rule:#A9A69B;--rule-soft:#33332E;--accent:#F04E14;--on-accent:#141412;--highlight:#D9F23E;--on-highlight:#141412;--success:#6FD08C;--danger:#FD8692;--inverse-bg:#F3F1EA;--inverse-text:#141412;--inverse-hover:#E3E0D5;--focus-ring:#F3F1EA}}',
];

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
    const css = tokensCss();
    expect(declarationsOf(css, 'color-scheme:light')).toBe(1);
    expect(declarationsOf(css, 'color-scheme:dark')).toBe(1);
    expect(count(css, '@media (prefers-color-scheme:dark)')).toBe(1);
  });

  it('every hex color is a token value', () => {
    const tokenValues = new Set([
      ...Object.values(color.light),
      ...Object.values(color.dark),
      ...Object.values(fixed),
    ]);
    const sources = [tokensCss(), ...Object.values(EMAIL_STYLES)];
    let seen = 0;
    for (const source of sources) {
      for (const match of source.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
        seen += 1;
        expect(tokenValues.has(match[0]), match[0]).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
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
