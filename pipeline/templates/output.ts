// The template output of stage 3 (PIPE-templates step 5) and the proof of each cited value.
import {
  FieldMetaRowSchema,
  Hex64Schema,
  IsoInstantSchema,
  SafeUrlSchema,
  StateCodeSchema,
  text,
} from '@citizenrun/shared';
import type { FieldMetaRow } from '@citizenrun/shared';
import { z } from 'zod';
import type { Evidence } from '../lib/confidence.ts';
import type { RunContext } from '../lib/runner.ts';
import { loadStageRows } from '../stages/shared/stage-io.ts';
import type { CitedNode } from './cited.ts';
import { QUOTE_REASONS } from './ground.ts';
import type { GroundedMark } from './ground.ts';
import { StateTemplateSchema } from './schema.ts';

export const GroundedMarkSchema: z.ZodType<GroundedMark> = z.strictObject({
  grounded: z.boolean(),
  checked_at: IsoInstantSchema.nullable(),
  text_sha256: Hex64Schema.nullable(),
  reason: z.enum(QUOTE_REASONS),
});

export const TemplateOutputSchema = z.strictObject({
  schema_version: z.literal(1),
  state: StateCodeSchema,
  template: StateTemplateSchema,
  grounded: z.record(z.string().min(1).max(300), GroundedMarkSchema), // keyed by the cited node's path
  checked_at: IsoInstantSchema, // the run's now
});
export type TemplateOutput = z.infer<typeof TemplateOutputSchema>;

/** One row per cited value, for the coverage count; the template file holds the quote itself. */
export const QuoteRowSchema = z.strictObject({
  path: z.string(),
  source_url: SafeUrlSchema,
  citation: text(300),
  grounded: z.boolean(),
  reason: z.enum(QUOTE_REASONS),
  checked_at: IsoInstantSchema.nullable(),
});
export type QuoteRow = z.infer<typeof QuoteRowSchema>;

/** The name given to `writeRows` for each of stage 3's files. */
export const S03_FILES = { template: 'template', quotes: 'quotes' } as const;

function markOf(out: TemplateOutput, path: string): GroundedMark | undefined {
  return out.grounded[path];
}

/** Medium when the cited value's quote is grounded (one grounded source), else low. */
export function citedConfidence(out: TemplateOutput, path: string): 'medium' | 'low' {
  return markOf(out, path)?.grounded === true ? 'medium' : 'low';
}

/** The `field_meta` entry of a cited value: its source, quote, level, last check and citation. */
export function citedMeta(out: TemplateOutput, path: string, node: CitedNode): FieldMetaRow {
  return FieldMetaRowSchema.parse({
    source_url: node.source_url,
    quote: node.quote,
    confidence: citedConfidence(out, path),
    checked_at: markOf(out, path)?.checked_at ?? out.checked_at,
    rule_citation: node.citation,
  });
}

/** A cited value as evidence: `statute` when its quote is grounded, `template_default` when not. */
export function citedEvidence(
  out: TemplateOutput,
  path: string,
  node: CitedNode,
  value: unknown,
): Evidence {
  const mark = markOf(out, path);
  return {
    kind: mark?.grounded === true ? 'statute' : 'template_default',
    value,
    source_url: node.source_url,
    quote: node.quote,
    rule_citation: node.citation,
    checked_at: mark?.checked_at ?? out.checked_at,
  };
}

/** The one line of the state's complete stage 3 `template` file, or null. */
export async function readTemplateOutput(
  ctx: RunContext,
  state: string,
): Promise<TemplateOutput | null> {
  const rows = await loadStageRows(
    ctx,
    's03-templates',
    state,
    S03_FILES.template,
    TemplateOutputSchema,
  );
  return rows?.[0] ?? null;
}
