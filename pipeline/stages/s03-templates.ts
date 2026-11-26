// Stage 3 (PIPE-templates): validate each state's template, ground its quotes and write the
// normalised template with one mark per cited value, and the quote list.
import { basename, join, resolve, sep } from 'node:path';
import { rulesFor } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';
import type { RunContext, StageModule, StageResult } from '../lib/runner.ts';
import { citedNodes } from '../templates/cited.ts';
import type { TemplateError } from '../templates/errors.ts';
import { groundCited } from '../templates/ground.ts';
import type { GroundedMark, PreviousMarks } from '../templates/ground.ts';
import {
  defaultTemplatesDir,
  listTemplateFiles,
  listYamlFiles,
  readTemplateFile,
} from '../templates/load.ts';
import { S03_FILES, TemplateOutputSchema, readTemplateOutput } from '../templates/output.ts';
import type { QuoteRow, TemplateOutput } from '../templates/output.ts';
import { validateTemplateText } from '../templates/validate.ts';
import type { ValidateResult } from '../templates/validate.ts';
import { repoRoot } from './shared/repo.ts';
import { loadReferenceIds } from './shared/reference.ts';
import { StageFileInvalid } from './shared/stage-io.ts';

export { S03_FILES } from '../templates/output.ts';

export type S03Deps = {
  readonly templatesDir: string;
  readonly rulesFor: (state: string) => StateRules | null;
  readonly loadReference: () => Promise<{
    officeTypeIds: ReadonlySet<string>;
    powerIds: ReadonlySet<string>;
  }>;
};

export type TemplateCheckLine = {
  readonly state: string;
  readonly ok: boolean;
  readonly errors: readonly TemplateError[];
};

const TEMPLATE_VALID = 'template_valid';
/** The paths a failed `template_valid` check names in its detail. */
const DETAIL_PATHS = 5;

function fixturesDir(): string {
  return join(repoRoot(), 'pipeline', 'templates', '__fixtures__');
}

/** True only for a file under the template fixtures folder, where placeholders are allowed. */
function isFixturePath(path: string): boolean {
  return resolve(path).startsWith(`${resolve(fixturesDir())}${sep}`);
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

async function validateFile(
  deps: S03Deps,
  reference: Awaited<ReturnType<S03Deps['loadReference']>>,
  state: string,
  path: string,
): Promise<ValidateResult> {
  const text = await readTemplateFile(path);
  return validateTemplateText(text, {
    state,
    officeTypeIds: reference.officeTypeIds,
    powerIds: reference.powerIds,
    rules: deps.rulesFor(state),
    isFixture: isFixturePath(path),
  });
}

function failedCheck(errors: readonly TemplateError[]): StageResult {
  const paths = errors.slice(0, DETAIL_PATHS).map((error) => error.path);
  return {
    files: [],
    checks: [
      {
        name: TEMPLATE_VALID,
        passed: false,
        detail: `errors=${String(errors.length)} paths=${paths.join(',')}`,
      },
    ],
    datasets: {},
  };
}

async function previousMarks(ctx: RunContext, state: string): Promise<PreviousMarks | null> {
  let previous: TemplateOutput | null;
  try {
    previous = await readTemplateOutput(ctx, state);
  } catch (error) {
    if (error instanceof StageFileInvalid) {
      ctx.log.warn('templates.previous_unreadable', { state });
      return null;
    }
    throw error;
  }
  if (previous === null) {
    return null;
  }
  const marks: Record<string, GroundedMark & { source_url: string; quote: string }> = {};
  for (const { path, node } of citedNodes(previous.template)) {
    const mark = previous.grounded[path];
    if (mark !== undefined) {
      marks[path] = { ...mark, source_url: node.source_url, quote: node.quote };
    }
  }
  return marks;
}

/** Stage 3 over the templates of `deps.templatesDir`, with the rules modules `deps.rulesFor` gives. */
export function makeS03Templates(deps: S03Deps): StageModule {
  let reference: ReturnType<S03Deps['loadReference']> | null = null;
  const loadReference = () => (reference ??= deps.loadReference());
  return {
    id: 's03-templates',
    milestone: 2,
    blockingChecks: [TEMPLATE_VALID],
    async states() {
      return (await listTemplateFiles(deps.templatesDir)).map((file) => file.state);
    },
    async run(ctx, state, opts): Promise<StageResult> {
      const file = (await listTemplateFiles(deps.templatesDir)).find(
        (entry) => entry.state === state,
      );
      if (file === undefined) {
        return failedCheck([{ path: 'file', message: 'the state has no template file' }]);
      }
      const validated = await validateFile(deps, await loadReference(), state, file.path);
      if (!validated.ok) {
        return failedCheck(validated.errors);
      }
      const template = validated.template;
      const nodes = citedNodes(template);
      const previous = await previousMarks(ctx, state);
      const marks = await groundCited(ctx, nodes, { state, previous });
      const output: TemplateOutput = TemplateOutputSchema.parse({
        schema_version: 1,
        state,
        template,
        grounded: marks,
        checked_at: ctx.now.toISOString(),
      });
      const rows: QuoteRow[] = nodes
        .map(({ path, node }) => {
          const mark = marks[path];
          return {
            path,
            source_url: node.source_url,
            citation: node.citation,
            grounded: mark?.grounded ?? false,
            reason: mark?.reason ?? 'fetch_error',
            checked_at: mark?.checked_at ?? null,
          };
        })
        .sort((a, b) => byteOrder(a.path, b.path));
      const templateFile = await opts.out.writeRows(S03_FILES.template, [output]);
      const quotesFile = await opts.out.writeRows(S03_FILES.quotes, rows);
      const grounded = rows.filter((row) => row.reason === 'grounded').length;
      const carried = rows.filter((row) => row.reason === 'carried').length;
      return {
        files: [templateFile, quotesFile],
        checks: [
          { name: TEMPLATE_VALID, passed: true, detail: 'errors=0' },
          {
            name: 'quotes',
            passed: true,
            detail: `grounded=${String(grounded)} carried=${String(carried)} ungrounded=${String(rows.length - grounded - carried)}`,
          },
        ],
        datasets: {},
      };
    },
  };
}

let defaultModule: StageModule | null = null;

function defaultS03(): StageModule {
  defaultModule ??= makeS03Templates({
    templatesDir: defaultTemplatesDir(),
    rulesFor,
    loadReference: () => loadReferenceIds(repoRoot()),
  });
  return defaultModule;
}

/** Stage 3 over `data/templates/` with the registered rules modules; built on first use. */
export const s03Templates: StageModule = {
  id: 's03-templates',
  milestone: 2,
  blockingChecks: [TEMPLATE_VALID],
  states: (ctx) => defaultS03().states(ctx),
  run: (ctx, state, opts) => defaultS03().run(ctx, state, opts),
};

/**
 * `templates --check`: every template file validated with its registered module, with no fetch
 * and no bucket. A `.yaml` file not named `<st>.yaml` is a failing line with path `file`.
 */
export async function checkTemplates(deps: S03Deps): Promise<readonly TemplateCheckLine[]> {
  const reference = await deps.loadReference();
  const lines: TemplateCheckLine[] = [];
  const named = new Map(
    (await listTemplateFiles(deps.templatesDir)).map((file) => [basename(file.path), file]),
  );
  for (const name of await listYamlFiles(deps.templatesDir)) {
    const file = named.get(name);
    if (file === undefined) {
      lines.push({
        state: name.slice(0, -'.yaml'.length),
        ok: false,
        errors: [{ path: 'file', message: 'a template file is named <st>.yaml' }],
      });
      continue;
    }
    const result = await validateFile(deps, reference, file.state, file.path);
    lines.push({ state: file.state, ok: result.ok, errors: result.ok ? [] : result.errors });
  }
  return lines;
}
