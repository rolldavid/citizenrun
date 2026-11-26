// Office titles and seat labels from a template's patterns. `B-offices.title` holds 200 characters.

const TITLE_MAX = 200;
const TOKEN = /\{([^{}]*)\}/g;

/** A pattern with an unknown token, a token whose value is not given, or an unusable result. */
export class TitleError extends Error {
  override readonly name = 'TitleError';
}

/**
 * Fills `{jurisdiction}`, `{label}` and `{position}` in a title pattern, collapses whitespace and
 * trims. Throws TitleError on another token, a token whose value is not given, an empty result or
 * one longer than 200 characters.
 */
export function fillTitle(
  pattern: string,
  vars: { readonly jurisdiction?: string; readonly label?: string; readonly position?: string },
): string {
  const filled = pattern.replace(TOKEN, (_match, name: string) => {
    if (name !== 'jurisdiction' && name !== 'label' && name !== 'position') {
      throw new TitleError('the title pattern has an unknown token');
    }
    const value = vars[name];
    if (value === undefined) {
      throw new TitleError(`the title pattern needs ${name}`);
    }
    return value;
  });
  const title = filled.replace(/\s+/g, ' ').trim();
  if (title === '' || title.length > TITLE_MAX) {
    throw new TitleError('the title is empty or longer than 200 characters');
  }
  return title;
}

/** Fills `{n}` in a `label_pattern` or `position_label_pattern`; any other token throws TitleError. */
export function fillLabel(pattern: string, n: number): string {
  return pattern.replace(TOKEN, (_match, name: string) => {
    if (name !== 'n') {
      throw new TitleError('the label pattern has an unknown token');
    }
    return String(n);
  });
}
