import { EMAIL_STYLES } from '@citizenrun/shared';
import { escapeHtml } from './escape.ts';

/** What one worker email holds: its title, a heading, its paragraphs and the footer line. */
export type LayoutInput = {
  title: string;
  heading: string;
  paragraphs: readonly string[];
  footer: string;
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
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${escapeHtml(input.title)}</title></head>` +
    `<body ${style('body')}><div ${style('container')}>` +
    `<h1 ${style('heading')}>${escapeHtml(input.heading)}</h1>` +
    paragraphs +
    `<hr ${style('rule')}>` +
    `<p ${style('footer')}>${escapeHtml(input.footer)}</p>` +
    '</div></body></html>'
  );
}
