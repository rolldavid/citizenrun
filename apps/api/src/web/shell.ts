import { sha256Source } from '../config/csp.ts';
import { escapeHtml } from './escape.ts';

/** The marker a shell response replaces with its head tags (L-web-shell). */
export const HEAD_MARKER = '<!--os:head-->';
/** The marker a shell response replaces with its body block, or with nothing (L-web-shell). */
export const BODY_MARKER = '<!--os:body-->';

/** The parsed shell: the template text and the hashes of its inline styles and scripts (L-csp). */
export type ShellTemplate = {
  html: string;
  scriptHashes: readonly string[];
  styleHashes: readonly string[];
};

/** The exported `index.html` does not hold one of the two markers exactly once. */
export class WebShellInvalidError extends Error {
  override readonly name = 'WebShellInvalidError';
  readonly marker: string;

  constructor(marker: string) {
    // The message names the marker only.
    super(`The shell template must hold ${marker} exactly once`);
    this.marker = marker;
  }
}

const TITLE_ELEMENT = /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi;
const META_ELEMENT = /<meta\b[^>]*>/gi;
const DESCRIPTION_NAME =
  /(?:^|\s)name\s*=\s*(?:"description"|'description'|description(?=[\s/>]|$))/i;
const STYLE_ELEMENT = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src(?:\s*=|[\s/]|$)/i;
const TYPE_ATTRIBUTE = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
// The types a browser runs as script; `application/json` blocks are data and are not hashed (L-csp).
const EXECUTABLE_TYPES: ReadonlySet<string> = new Set(['', 'text/javascript', 'module']);

function occurrences(text: string, needle: string): number {
  let count = 0;
  let from = text.indexOf(needle);
  while (from !== -1) {
    count += 1;
    from = text.indexOf(needle, from + needle.length);
  }
  return count;
}

function isExecutableScript(attributes: string): boolean {
  if (SRC_ATTRIBUTE.test(attributes)) {
    return false;
  }
  const type = TYPE_ATTRIBUTE.exec(attributes);
  if (type === null) {
    return true;
  }
  const value = type[1] ?? type[2] ?? type[3] ?? '';
  return EXECUTABLE_TYPES.has(value.trim().toLowerCase());
}

// Each hash once, in document order.
function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

/**
 * Parses the exported `index.html` (L-web-shell): each marker must occur exactly once, the
 * template's own `<title>` and description meta are removed, and the CSP hashes are taken over the
 * exact text of every inline `<style>` and every inline executable `<script>`.
 */
export function parseShellTemplate(indexHtml: string): ShellTemplate {
  for (const marker of [HEAD_MARKER, BODY_MARKER]) {
    if (occurrences(indexHtml, marker) !== 1) {
      throw new WebShellInvalidError(marker);
    }
  }
  const styleHashes: string[] = [];
  for (const match of indexHtml.matchAll(STYLE_ELEMENT)) {
    styleHashes.push(sha256Source(match[2] ?? ''));
  }
  const scriptHashes: string[] = [];
  for (const match of indexHtml.matchAll(SCRIPT_ELEMENT)) {
    if (isExecutableScript(match[1] ?? '')) {
      scriptHashes.push(sha256Source(match[2] ?? ''));
    }
  }
  const html = indexHtml
    .replace(TITLE_ELEMENT, '')
    .replace(META_ELEMENT, (element) => (DESCRIPTION_NAME.test(element) ? '' : element));
  return Object.freeze({
    html,
    scriptHashes: unique(scriptHashes),
    styleHashes: unique(styleHashes),
  });
}

function replaceOnce(text: string, marker: string, replacement: string): string {
  const at = text.indexOf(marker);
  return at === -1 ? text : text.slice(0, at) + replacement + text.slice(at + marker.length);
}

const NOINDEX_META = '<meta name="robots" content="noindex">';

/**
 * One shell response (L-web-shell): the head marker becomes the escaped `<title>`, followed by the
 * `noindex` robots meta when asked, and the body marker becomes nothing; nothing else in the
 * template changes.
 */
export function fillShell(
  template: ShellTemplate,
  input: { title: string; noindex?: boolean },
): string {
  const head = `<title>${escapeHtml(input.title)}</title>${input.noindex === true ? NOINDEX_META : ''}`;
  return replaceOnce(replaceOnce(template.html, HEAD_MARKER, head), BODY_MARKER, '');
}
