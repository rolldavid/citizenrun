// The complete HTML page around one rendered document (L-legal-docs, DS-css).
import { DOCUMENT_PAGE_CSS } from '@citizenrun/shared';
import { escapeHtml } from '../escape.ts';
import type { RenderedDocument } from './render.ts';

export type DocumentChrome = {
  appName: string;
  publicUrl: string;
  path: string;
  documentTitle: string;
  effectiveDate: string;
  footer: readonly { href: string; label: string }[];
};

function footerLink(entry: { href: string; label: string }, currentPath: string): string {
  const current = entry.href === currentPath ? ' aria-current="page"' : '';
  return `<a href="${escapeHtml(entry.href)}"${current}>${escapeHtml(entry.label)}</a>`;
}

/**
 * The page: every value through escapeHtml, the stylesheet written byte for byte so its hash in the
 * policy matches, no class, no inline style attribute and no script. The document's own HTML is
 * already escaped by the renderer.
 */
export function buildDocumentPage(doc: RenderedDocument, chrome: DocumentChrome): string {
  const footer = chrome.footer.map((entry) => footerLink(entry, chrome.path)).join('');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(chrome.documentTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(doc.description)}">`,
    `<link rel="canonical" href="${escapeHtml(chrome.publicUrl + chrome.path)}">`,
    `<style>${DOCUMENT_PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    `<header><a href="/">${escapeHtml(chrome.appName)}</a></header>`,
    '<main><article>',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<p>${escapeHtml(chrome.effectiveDate)}</p>`,
    doc.bodyHtml,
    '</article></main>',
    `<footer>${footer}</footer>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
