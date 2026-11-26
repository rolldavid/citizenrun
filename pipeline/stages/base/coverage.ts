// The stage-internal `coverage` file of stage 1: one `{ name, value }` row per counter, sorted by
// name, each value a non-negative integer.
import { z } from 'zod';

export const CoverageRowSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_]+(:[a-z0-9_-]+)*$/),
  value: z.int().min(0),
});
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

/** Counters by name; a counter that is set to 0 is still written. */
export class Coverage {
  private readonly values = new Map<string, number>();

  set(name: string, value: number): void {
    this.values.set(name, value);
  }

  add(name: string, by = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + by);
  }

  get(name: string): number {
    return this.values.get(name) ?? 0;
  }

  /** The rows in byte order of their names, each parsed with CoverageRowSchema. */
  rows(): CoverageRow[] {
    return [...this.values]
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([name, value]) => CoverageRowSchema.parse({ name, value }));
  }
}
