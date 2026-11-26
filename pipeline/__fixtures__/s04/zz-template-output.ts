// The stage 3 output of the fixture template zz-template.yaml with every quote grounded.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { citedNodes } from '../../templates/cited.ts';
import type { GroundedMark } from '../../templates/ground.ts';
import { TemplateOutputSchema } from '../../templates/output.ts';
import type { TemplateOutput } from '../../templates/output.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { validateTemplateText } from '../../templates/validate.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import { repoRoot } from '../../stages/shared/repo.ts';
import { loadReferenceIds } from '../../stages/shared/reference.ts';

export const ZZ_GROUNDED_AT = '2026-11-15T00:00:00.000Z';
const TEXT_SHA = 'a'.repeat(64);

/** The text of the fixture template. */
export async function zzTemplateText(): Promise<string> {
  return readFile(join(repoRoot(), 'pipeline', 'templates', '__fixtures__', 'zz-template.yaml'), 'utf8');
}

/** The template parsed and validated with the ZZ rules. */
export async function zzTemplate(text?: string): Promise<StateTemplate> {
  const ids = await loadReferenceIds(repoRoot());
  const result = validateTemplateText(text ?? (await zzTemplateText()), {
    state: 'ZZ',
    officeTypeIds: ids.officeTypeIds,
    powerIds: ids.powerIds,
    rules: ZZ_RULES,
    isFixture: true,
  });
  if (!result.ok) {
    throw new Error(`the fixture template does not validate: ${result.errors.map((e) => e.path).join(', ')}`);
  }
  return result.template;
}

/** A template output for `template` with every cited value grounded at ZZ_GROUNDED_AT. */
export function groundedOutput(template: StateTemplate): TemplateOutput {
  const grounded: Record<string, GroundedMark> = {};
  for (const { path } of citedNodes(template)) {
    grounded[path] = { grounded: true, checked_at: ZZ_GROUNDED_AT, text_sha256: TEXT_SHA, reason: 'grounded' };
  }
  return TemplateOutputSchema.parse({
    schema_version: 1,
    state: 'ZZ',
    template,
    grounded,
    checked_at: ZZ_GROUNDED_AT,
  });
}

/** The fixture template's output with every quote grounded. */
export async function zzTemplateOutput(): Promise<TemplateOutput> {
  return groundedOutput(await zzTemplate());
}
