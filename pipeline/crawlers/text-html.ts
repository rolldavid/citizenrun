// PIPE-text-extract step 1: the main text of an HTML page, the exact text grounding reads (D-285).
import { load } from 'cheerio';

const REMOVED =
  'script, style, noscript, template, svg, iframe, nav, header, footer, aside, form, [role=navigation], [aria-hidden="true"]';
const ROOTS = ['main', 'article', '[role=main]', 'body'] as const;
const BLOCKS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'li',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'section',
  'table',
  'dd',
  'dt',
]);
const CELLS: ReadonlySet<string> = new Set(['td', 'th']);
const HTML_SPACE = /[\t\n\f\r ]+/g;

/** The parts of a parsed node this walk reads. */
type DomNode = {
  readonly type: string;
  readonly data?: string;
  readonly name?: string;
  readonly children?: readonly DomNode[];
};

function isElement(
  node: DomNode,
): node is DomNode & { name: string; children: readonly DomNode[] } {
  return (
    (node.type === 'tag' || node.type === 'script' || node.type === 'style') &&
    node.name !== undefined
  );
}

function write(node: DomNode, out: string[]): void {
  if (node.type === 'text') {
    out.push((node.data ?? '').replace(HTML_SPACE, ' '));
    return;
  }
  if (!isElement(node)) {
    return;
  }
  const name = node.name.toLowerCase();
  if (name === 'br') {
    out.push('\n');
    return;
  }
  if (name === 'tr') {
    const cells = node.children.filter(
      (child) => isElement(child) && CELLS.has(child.name.toLowerCase()),
    );
    if (cells.length > 0) {
      const texts = cells.map((cell) => {
        const inner: string[] = [];
        write(cell, inner);
        return inner.join('').replace(/\s+/g, ' ').trim();
      });
      out.push(texts.join(' | '), '\n');
      return;
    }
  }
  for (const child of node.children) {
    write(child, out);
  }
  if (BLOCKS.has(name)) {
    out.push('\n');
  }
}

/**
 * The page's main text: navigation, scripts and forms removed; `main`, else `article`, else
 * `[role=main]`, else `body`; a newline after each block element; a row's cells joined by ` | `;
 * runs of spaces collapsed within a line; empty lines dropped; NFC.
 */
export function extractHtmlText(html: string): string {
  const $ = load(html);
  $(REMOVED).remove();
  let root: DomNode | undefined;
  for (const selector of ROOTS) {
    const found = $(selector).first().get(0);
    if (found !== undefined) {
      root = found;
      break;
    }
  }
  if (root === undefined) {
    return '';
  }
  const out: string[] = [];
  write(root, out);
  return out
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .normalize('NFC');
}
