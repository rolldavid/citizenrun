// L-legal-docs: the Markdown subset of the legal and public information pages, with no Markdown
// library. Every text run passes escapeHtml and every link passes isSafeHref (INV-55).
import { escapeHtml, isSafeHref } from '../escape.ts';

export const PLACEHOLDER_NAMES = [
  'appName',
  'publicUrl',
  'supportEmail',
  'postalAddress',
  'dmcaAgentName',
  'dmcaAgentAddress',
  'dmcaAgentPhone',
  'dmcaAgentEmail',
  'childSafetyContactName',
  'childSafetyContactEmail',
] as const;

export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];
export type PlaceholderValues = Readonly<Record<PlaceholderName, string | null>>;
export type RenderedDocument = {
  version: string;
  title: string;
  description: string;
  bodyHtml: string;
};
export type DocumentErrorReason =
  'front_matter' | 'unknown_placeholder' | 'unsafe_link' | 'placeholder_in_link' | 'nested_list';

/** A document that breaks a rule of L-legal-docs. `detail` names the rule, never the document's text. */
export class DocumentError extends Error {
  override readonly name = 'DocumentError';
  readonly reason: DocumentErrorReason;
  readonly detail: string;
  /** The file the loader was reading, or null when the text did not come from a file. */
  readonly file: string | null;

  constructor(reason: DocumentErrorReason, detail: string, file: string | null = null) {
    super(file === null ? `${reason}: ${detail}` : `${file}: ${reason}: ${detail}`);
    this.reason = reason;
    this.detail = detail;
    this.file = file;
  }
}

const FRONT_MATTER_FENCE = '---';
const FRONT_MATTER_KEYS = ['version', 'title', 'description'] as const;
type FrontMatterKey = (typeof FRONT_MATTER_KEYS)[number];
const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KEY_SEPARATOR = ': ';

const HEADING_MARKERS: readonly { prefix: string; level: 1 | 2 | 3 }[] = [
  { prefix: '# ', level: 1 },
  { prefix: '## ', level: 2 },
  { prefix: '### ', level: 3 },
];
const UNORDERED_ITEM = /^- /;
const ORDERED_ITEM = /^\d+\. /;
const NESTED_ITEM = /^[ \t]+(?:- |\d+\. )/;
const BLANK_LINE = /^ *$/;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const PLACEHOLDER = /\{\{([A-Za-z]+)\}\}/g;
const EXTERNAL_PREFIX = 'https://';

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] };

type RenderInput = { values: PlaceholderValues; pendingText: string };

function isPlaceholderName(name: string): name is PlaceholderName {
  return (PLACEHOLDER_NAMES as readonly string[]).includes(name);
}

function isFrontMatterKey(key: string): key is FrontMatterKey {
  return (FRONT_MATTER_KEYS as readonly string[]).includes(key);
}

// The value of one placeholder, or the pending sentence while it is null; throws on an unknown name.
function placeholderValue(name: string, input: RenderInput): string {
  if (!isPlaceholderName(name)) {
    throw new DocumentError('unknown_placeholder', name);
  }
  return input.values[name] ?? input.pendingText;
}

// Placeholders filled, nothing escaped: the title and description, which the page escapes.
function fillPlain(text: string, input: RenderInput): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => placeholderValue(name, input));
}

// Placeholders filled and every character escaped.
function fillEscaped(text: string, input: RenderInput): string {
  let html = '';
  let position = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    html += escapeHtml(text.slice(position, match.index));
    html += escapeHtml(placeholderValue(match[1] ?? '', input));
    position = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(position));
}

// Text runs: bold, placeholders and escaping; an unmatched `**` stays literal.
function renderRun(text: string, input: RenderInput): string {
  let html = '';
  let position = 0;
  for (const match of text.matchAll(BOLD)) {
    html += fillEscaped(text.slice(position, match.index), input);
    html += `<strong>${fillEscaped(match[1] ?? '', input)}</strong>`;
    position = match.index + match[0].length;
  }
  return html + fillEscaped(text.slice(position), input);
}

// Links first, then the text runs around and inside them.
function renderInline(text: string, input: RenderInput): string {
  let html = '';
  let position = 0;
  for (const match of text.matchAll(LINK)) {
    const label = match[1] ?? '';
    const href = match[2] ?? '';
    if (href.includes('{{')) {
      throw new DocumentError('placeholder_in_link', 'a link target holds a placeholder');
    }
    if (!isSafeHref(href)) {
      throw new DocumentError('unsafe_link', 'a link target is neither a path nor an https URL');
    }
    html += renderRun(text.slice(position, match.index), input);
    const rel = href.startsWith(EXTERNAL_PREFIX) ? ' rel="noopener noreferrer"' : '';
    html += `<a href="${escapeHtml(href)}"${rel}>${renderRun(label, input)}</a>`;
    position = match.index + match[0].length;
  }
  return html + renderRun(text.slice(position), input);
}

function parseFrontMatter(lines: readonly string[]): {
  fields: Record<FrontMatterKey, string>;
  bodyStart: number;
} {
  if (lines[0] !== FRONT_MATTER_FENCE) {
    throw new DocumentError('front_matter', 'the text does not start with ---');
  }
  const close = lines.indexOf(FRONT_MATTER_FENCE, 1);
  if (close === -1) {
    throw new DocumentError('front_matter', 'the front matter has no closing ---');
  }
  const found: Partial<Record<FrontMatterKey, string>> = {};
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(KEY_SEPARATOR);
    if (at === -1) {
      throw new DocumentError('front_matter', 'a front matter line is not key: value');
    }
    const key = line.slice(0, at).trim();
    const value = line.slice(at + KEY_SEPARATOR.length).trim();
    if (!isFrontMatterKey(key)) {
      throw new DocumentError('front_matter', 'an unknown front matter key');
    }
    if (found[key] !== undefined) {
      throw new DocumentError('front_matter', `the key ${key} appears twice`);
    }
    if (value === '') {
      throw new DocumentError('front_matter', `the key ${key} is empty`);
    }
    found[key] = value;
  }
  const { version, title, description } = found;
  if (version === undefined || title === undefined || description === undefined) {
    const missing = FRONT_MATTER_KEYS.filter((key) => found[key] === undefined);
    throw new DocumentError('front_matter', `missing ${missing.join(', ')}`);
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new DocumentError('front_matter', 'the version is not YYYY-MM-DD');
  }
  return { fields: { version, title, description }, bodyStart: close + 1 };
}

function headingOf(line: string): Block | null {
  for (const marker of HEADING_MARKERS) {
    if (line.startsWith(marker.prefix)) {
      return {
        kind: 'heading',
        level: marker.level,
        text: line.slice(marker.prefix.length).trim(),
      };
    }
  }
  return null;
}

function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  // Ends the open block, if any; returns null for the caller to store as the new open block.
  const flush = (block: Block | null): null => {
    if (block !== null) {
      blocks.push(block);
    }
    return null;
  };
  let open: Block | null = null;
  for (const line of lines) {
    if (BLANK_LINE.test(line)) {
      open = flush(open);
      continue;
    }
    if (NESTED_ITEM.test(line)) {
      throw new DocumentError('nested_list', 'lists have one level');
    }
    const heading = headingOf(line);
    if (heading !== null) {
      open = flush(open);
      blocks.push(heading);
      continue;
    }
    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered === null ? ORDERED_ITEM.exec(line) : null;
    const marker = unordered ?? ordered;
    if (marker !== null) {
      const isOrdered = ordered !== null;
      const text = line.slice(marker[0].length).trim();
      if (open !== null && open.kind === 'list' && open.ordered === isOrdered) {
        open.items.push(text);
      } else {
        flush(open);
        open = { kind: 'list', ordered: isOrdered, items: [text] };
      }
      continue;
    }
    if (open === null) {
      open = { kind: 'paragraph', lines: [line.trim()] };
    } else if (open.kind === 'list') {
      // A line with no marker continues the previous item.
      const last = open.items.length - 1;
      open.items[last] = `${open.items[last] ?? ''} ${line.trim()}`;
    } else {
      open.lines.push(line.trim());
    }
  }
  flush(open);
  return blocks;
}

function renderBlock(block: Block, input: RenderInput): string {
  switch (block.kind) {
    case 'heading':
      return `<h${String(block.level)}>${renderInline(block.text, input)}</h${String(block.level)}>`;
    case 'paragraph':
      return `<p>${renderInline(block.lines.join(' '), input)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${renderInline(item, input)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
  }
}

/**
 * Renders one document of the Markdown subset of L-legal-docs. `title` and `description` come back
 * with placeholders filled and unescaped; `bodyHtml` is escaped HTML. A placeholder whose value is
 * null renders `pendingText`. Throws DocumentError on any rule the text breaks.
 */
export function renderDocument(src: string, input: RenderInput): RenderedDocument {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const { fields, bodyStart } = parseFrontMatter(lines);
  const blocks = parseBlocks(lines.slice(bodyStart));
  return {
    version: fields.version,
    title: fillPlain(fields.title, input),
    description: fillPlain(fields.description, input),
    bodyHtml: blocks.map((block) => renderBlock(block, input)).join('\n'),
  };
}
