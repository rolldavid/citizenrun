import { EMAIL_STYLES } from '@citizenrun/shared';
import { escapeHtml } from './escape.ts';

/**
 * What one worker email holds: its title, a heading, its paragraphs, the footer line (null leaves
 * out the rule and the footer) and the page language (default 'en').
 */
export type LayoutInput = {
  title: string;
  heading: string;
  paragraphs: readonly string[];
  footer: string | null;
  lang?: string;
};

// The value is escaped too: a font stack quotes family names ("Segoe UI"), which would otherwise
// end the attribute. The decoded value is the EMAIL_STYLES member itself.
function style(name: keyof typeof EMAIL_STYLES): string {
  return `style="${escapeHtml(EMAIL_STYLES[name])}"`;
}

/**
 * The worker's one HTML email layout: every style an inline EMAIL_STYLES value and every text
 * escaped once here. No image, link, remote content or tracking.
 */
export function renderLayout(input: LayoutInput): string {
  const paragraphs = input.paragraphs
    .map((text) => `<p ${style('paragraph')}>${escapeHtml(text)}</p>`)
    .join('');
  const footer =
    input.footer === null
      ? ''
      : `<hr ${style('rule')}><p ${style('footer')}>${escapeHtml(input.footer)}</p>`;
  return (
    `<!doctype html><html lang="${escapeHtml(input.lang ?? 'en')}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(input.title)}</title></head>` +
    `<body ${style('body')}><div ${style('container')}>` +
    `<h1 ${style('heading')}>${escapeHtml(input.heading)}</h1>` +
    paragraphs +
    footer +
    '</div></body></html>'
  );
}
