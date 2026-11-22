import type { z } from 'zod';

/** A failed environment parse. It names the bad variables and never holds a value. */
export class EnvError extends Error {
  override readonly name = 'EnvError';
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Invalid environment variables: ${variables.join(', ')}`);
    this.variables = variables;
  }
}

/**
 * Parses `source` (a service passes its process environment) with `schema` and returns a frozen
 * object. Throws EnvError naming each bad variable, sorted; no zod message is copied, because a
 * zod message can quote the value.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Readonly<Record<string, string | undefined>>,
): Readonly<z.infer<S>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = new Set<string>();
    for (const issue of result.error.issues) {
      const first = issue.path[0];
      if (first !== undefined) {
        names.add(String(first));
      }
    }
    throw new EnvError([...names].sort());
  }
  return Object.freeze(result.data);
}
