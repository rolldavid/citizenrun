const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * `text` safe to place in HTML text or a quoted attribute: `&`, `<`, `>`, `"` and `'` become
 * entities. One pass, so an `&` this adds is never escaped again.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}
