import { EMAIL_STYLES } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.ts';
import { renderLayout } from './layout.ts';

// A style attribute as the layout writes it: the EMAIL_STYLES value, escaped once.
function style(name: keyof typeof EMAIL_STYLES): string {
  return `style="${escapeHtml(EMAIL_STYLES[name])}"`;
}

describe('the email layout', () => {
  it('a page with a footer and no language is unchanged', () => {
    const page = renderLayout({
      title: 'T & t',
      heading: 'H',
      paragraphs: ['P1', 'P2 <x>'],
      footer: 'F',
    });
    expect(page).toBe(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T &amp; t</title></head>' +
        `<body ${style('body')}><div ${style('container')}>` +
        `<h1 ${style('heading')}>H</h1>` +
        `<p ${style('paragraph')}>P1</p>` +
        `<p ${style('paragraph')}>P2 &lt;x&gt;</p>` +
        `<hr ${style('rule')}>` +
        `<p ${style('footer')}>F</p>` +
        '</div></body></html>',
    );
  });

  it('leaves out the rule and the footer when there is no footer', () => {
    const page = renderLayout({
      title: 'T',
      heading: 'H',
      paragraphs: ['P1', 'P2'],
      footer: null,
    });
    expect(page).not.toContain('<hr');
    expect(page).not.toContain(style('footer'));
    expect(page).toContain(`<p ${style('paragraph')}>P1</p>`);
    expect(page).toContain(`<p ${style('paragraph')}>P2</p>`);
    expect(page.endsWith('</p></div></body></html>')).toBe(true);
  });

  it('writes the page language', () => {
    const base = { title: 'T', heading: 'H', paragraphs: ['P'], footer: 'F' };
    expect(renderLayout({ ...base, lang: 'es' })).toContain('<html lang="es">');
    expect(renderLayout(base)).toContain('<html lang="en">');
    expect(renderLayout({ ...base, lang: 'x"><b' })).toContain('<html lang="x&quot;&gt;&lt;b">');
  });

  it('escapes every text once', () => {
    const raw = `a<b & "c" 'd'`;
    const escaped = 'a&lt;b &amp; &quot;c&quot; &#39;d&#39;';
    const page = renderLayout({
      title: raw,
      heading: raw,
      paragraphs: ['plain', raw],
      footer: raw,
    });
    expect(page).toContain(`<title>${escaped}</title>`);
    expect(page).toContain(`<h1 ${style('heading')}>${escaped}</h1>`);
    expect(page).toContain(`<p ${style('paragraph')}>${escaped}</p>`);
    expect(page).toContain(`<p ${style('footer')}>${escaped}</p>`);
    expect(page).not.toContain('&amp;lt;');
    expect(page).not.toContain(raw);
  });
});
