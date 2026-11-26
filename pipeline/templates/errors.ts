/**
 * One problem in a template file. `path` is the YAML path, keys and array indexes joined by `.`
 * (`government_types.0.offices.1.powers.0.power`), or `line <n>` for a text-level problem. The
 * message never carries a value from the file.
 */
export type TemplateError = { readonly path: string; readonly message: string };

/** Joins a parsed path's keys and indexes with `.`. */
export function joinPath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === 'symbol' ? (part.description ?? '') : String(part)))
    .join('.');
}
